//! 回归: **writer 死在受理任何批次之前不得升级成录制故障**。
//!
//! 审计 M2 (backend B2) 的缺口: `run_writer` 曾经为**任何**写入循环错误置粘性的
//! `health.failed`, 包括 `WriterStorage::open` (连接) 与 `next_row_id` (首批序号)
//! 这两个跑在任何批次之前、从未取到批次的 bootstrap 调用。`Recorder::append`
//! 随即在**入队之前**转成 [`RecordingError::Failed`], hub 把它分类成契约故障,
//! 读任务于是每批字节后都把工作区停回 Stopped —— 正是
//! `docs/architecture/crates.md` 录制契约边界要杜绝的「数据库打不开 = 没有录制,
//! 绝不是录制失败」。
//!
//! 这里用真实的写入循环 + 连接必然失败的 engine 复现 bootstrap 失败, 断言:
//! 1. [`RecordingHub::fault`] 保持 `None` (采集门控依据);
//! 2. [`RecordingHub::health`] 仍然把失败报得出来 (可见性不得丢失);
//! 3. 生产者看到未绑定、投递批次只算「没有录制」(绝不是 `Err(Failed)`);
//! 4. 控制往返 (`flush`) 撞上已死的 writer 同样只算「不可用」。

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;

use super::{RecordingHub, unique_bindings};
use crate::port::{StoreEngine, StoreSession};
use crate::{
    BatchPayload, BindingCapability, DisplayBinding, Domain, PortIdentity, Recorder,
    RecordingError, RecordingStore,
};

/// 单次断言的宽限 — 写线程启动与登记是毫秒级, 这里只给调度抖动留余量。
const SLACK: Duration = Duration::from_secs(2);

/// 连接必然失败的 engine — 复现「数据库打不开」落在 writer 线程 bootstrap 阶段
/// (`WriterStorage::open`) 的样子, 而 `RecordingStore::open` 早已成功。
///
/// 故意回一个**契约类**错误 ([`RecordingError::Io`] — `classify` 判 `Contract`):
/// 本回归验证的是失败发生在哪个**阶段** (受理批次之前), 不是错误类型。
#[derive(Debug)]
struct NeverConnects;

impl NeverConnects {
    fn bootstrap_error() -> RecordingError {
        RecordingError::Io(std::io::Error::other(
            "bootstrap: the recording database cannot be opened",
        ))
    }
}

#[async_trait]
impl StoreEngine for NeverConnects {
    async fn open(
        &self,
        _path: &Path,
    ) -> Result<(Box<dyn StoreSession>, Option<String>), RecordingError> {
        Err(Self::bootstrap_error())
    }

    async fn connect(&self, _path: &Path) -> Result<Box<dyn StoreSession>, RecordingError> {
        Err(Self::bootstrap_error())
    }

    async fn connect_read_only(
        &self,
        _path: &Path,
    ) -> Result<Box<dyn StoreSession>, RecordingError> {
        Err(Self::bootstrap_error())
    }
}

impl RecordingHub {
    /// 装入一个 bootstrap 必然失败的 writer 与一组绑定 (**仅 `cfg(test)` 编译**)。
    fn install_bootstrap_failing_recorder_for_test(&self, bindings: Vec<DisplayBinding>) {
        let store = RecordingStore::with_engine_for_test(
            std::env::temp_dir().join(format!(
                "lissio-recording-bootstrap-{}.duckdb",
                std::process::id()
            )),
            Arc::new(NeverConnects),
        );
        let recorder = Recorder::bootstrap_failing_for_test(store, bindings.clone());
        let mut state = self.state.write();
        state.recorder = Some(Arc::new(recorder));
        state.active = unique_bindings(bindings);
        state.enabled = true;
        state.fault = None;
        state.unavailable = None;
    }
}

fn binding(id: &str, domain: Domain) -> DisplayBinding {
    DisplayBinding {
        id: id.into(),
        component_id: format!("component-{id}"),
        port: PortIdentity::new("source", id),
        domain,
        capability: BindingCapability::Records,
    }
}

/// 有界等待写入线程登记 bootstrap 失败 — 回归测试必须**失败**而不是挂住。
fn await_registered_failure(hub: &RecordingHub) {
    let deadline = Instant::now() + SLACK;
    while hub.health().failed.is_none() {
        assert!(
            Instant::now() < deadline,
            "写入线程未在上限内登记 bootstrap 失败"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn a_writer_that_fails_before_accepting_a_batch_is_not_a_recording_fault() {
    let hub = RecordingHub::default();
    let bound = binding("bytes", Domain::Bytes);
    let port = bound.port.clone();
    hub.install_bootstrap_failing_recorder_for_test(vec![bound]);

    await_registered_failure(&hub);

    // 采集门控依据: 受理任何批次之前失败 = 没有录制, 不是录制失败。
    assert!(
        hub.fault().is_none(),
        "受理前的 writer 失败不是录制契约故障: {:?}",
        hub.fault()
    );
    // 生产者看到未绑定 → 所有热路径自然停录 (连载荷都不必构造)。
    assert!(
        !hub.is_bound(&port),
        "writer 已死, 生产者必须看到未绑定 (没有录制)"
    );
    // 直接投递 (绕过 is_bound) 同样只算「没有录制」, 绝不是 `Err(Failed)`。
    let recorded = hub.record(
        &port,
        1,
        0,
        Vec::from([1_u64]),
        BatchPayload::Bytes {
            data: Vec::from([0_u8; 8]),
        },
    );
    assert!(
        matches!(recorded, Ok(false)),
        "不可用时批次只是没被录制: {recorded:?}"
    );
    assert!(
        hub.fault().is_none(),
        "反复投递不得把「没有录制」升级成故障: {:?}",
        hub.fault()
    );

    // 控制往返 (运行控制 / 绑定同步) 撞上已死的 writer: 仍然只是「不可用」。
    assert!(hub.flush().is_err(), "已死的 writer 不可能应答");
    assert!(
        hub.fault().is_none(),
        "控制往返的失败不得升级成契约故障: {:?}",
        hub.fault()
    );

    // 可见性不得丢失: 用户必须知道数据没有被录制。
    let health = hub.health();
    assert!(
        health.failed.is_some(),
        "「没有录制」必须对用户可见 (failed/unavailable 通道)"
    );
    assert!(health.enabled, "这不是用户关掉开关");
}
