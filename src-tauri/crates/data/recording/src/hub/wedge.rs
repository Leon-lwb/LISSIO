//! 回归: **writer 卡死不得冻结采集热路径与运行控制**。
//!
//! Windows 上 DuckDB 的强制文件锁会让写线程永久停在一次调用里。曾经的后果是
//! 调用链 `hub::set_state` 持状态写锁等 writer → `is_bound()` 全堵 → 界面「点开始
//! 只出几个字符」; 运行控制又堵在同一把锁上 → 暂停再也解不开。
//!
//! 这里用 [`Recorder::wedged_for_test`] 注入一个永不应答的 writer (仅测试编译),
//! 断言四件事:
//! 1. 卡死期间采集热路径 (`is_bound` / `record`) 仍然是微秒级;
//! 2. 控制往返 (`set_state`) 在预算内返回 [`RecordingError::Timeout`];
//! 3. 关停 (`stop`) 与维护 (`flush`) 同样有界 — 不会去 join 一个卡死的线程;
//! 4. 卡死只报「不可用」, **绝不置 fault** — 否则运行控制会把采集停掉。

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::{RecordingHub, unique_bindings};
use crate::{
    BatchPayload, BindingCapability, DisplayBinding, Domain, PortIdentity, Recorder,
    RecordingError, RecordingStore, SessionState,
};

/// 单次断言的宽限 — 预算本身是毫秒级, 这里只给调度抖动留余量。
const SLACK: Duration = Duration::from_secs(2);

impl RecordingHub {
    /// 装入一个永不应答的 writer 与一组绑定 (**仅 `cfg(test)` 编译**)。
    fn install_wedged_recorder_for_test(
        &self,
        database: &Path,
        bindings: Vec<DisplayBinding>,
    ) -> RecordingStore {
        let store = RecordingStore::open(database).expect("测试用数据库应可打开");
        let recorder = Recorder::wedged_for_test(store.clone(), bindings.clone());
        let mut state = self.state.write();
        state.recorder = Some(Arc::new(recorder));
        state.active = unique_bindings(bindings);
        state.enabled = true;
        state.fault = None;
        state.unavailable = None;
        store
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

fn wedged_hub(name: &str) -> (RecordingHub, PortIdentity) {
    let database = std::env::temp_dir().join(format!(
        "lissio-recording-wedge-{}-{name}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&database);
    let hub = RecordingHub::default();
    let bound = binding("bytes", Domain::Bytes);
    let port = bound.port.clone();
    hub.install_wedged_recorder_for_test(&database, vec![bound]);
    (hub, port)
}

/// 在宽限内跑完 `work` 并取其返回值; 超时即判定为**无界阻塞**并失败。
///
/// 回归测试必须**失败**而不是挂住: 旧实现 (无界 `send`/`recv`) 会让调用方永久
/// 停在 writer 上, 直接调用会把测试进程一起挂死。
fn completed_within<T: Send + 'static>(
    label: &str,
    work: impl FnOnce() -> T + Send + 'static,
) -> T {
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = sender.send(work());
    });
    receiver.recv_timeout(SLACK).unwrap_or_else(|_| {
        panic!("{label} 无界阻塞: 超过 {SLACK:?} 仍未返回 (writer 卡死时必须摘除/超时)")
    })
}

#[test]
fn a_wedged_writer_cannot_freeze_the_acquisition_path_or_run_control() {
    let (hub, port) = wedged_hub("control");
    assert!(hub.is_bound(&port), "注入的 writer 应当处于绑定状态");

    // 运行控制撞上卡死的 writer — 这是在真实 Windows 卡死里「暂停解不开」的那一步。
    let (control_sender, control) = std::sync::mpsc::channel();
    {
        let hub = hub.clone();
        std::thread::spawn(move || {
            let started = Instant::now();
            let outcome = hub.set_state(SessionState::Stopped);
            let _ = control_sender.send((outcome, started.elapsed()));
        });
    }

    // 往返在途时, 采集热路径必须照常 (曾经它堵在状态锁上)。
    std::thread::sleep(Duration::from_millis(20));
    let sampled = Instant::now();
    for _ in 0..100 {
        assert!(hub.is_bound(&port));
    }
    assert!(
        sampled.elapsed() < Duration::from_millis(100),
        "is_bound 被卡死的 writer 堵住了: {:?}",
        sampled.elapsed()
    );
    // 批次照常被受理判定, 只是因背压丢弃 (Ok(false)), 不升级成错误。
    let recorded = hub.record(
        &port,
        1,
        0,
        Vec::from([1_u64]),
        BatchPayload::Bytes {
            data: Vec::from([0_u8]),
        },
    );
    assert!(recorded.is_ok(), "背压不得冒泡成错误: {recorded:?}");
    assert!(!recorded.unwrap());

    let (outcome, elapsed) = control.recv_timeout(SLACK).unwrap_or_else(|_| {
        panic!("运行控制无界阻塞: writer 卡死时 set_state 必须在预算内超时返回")
    });
    assert!(
        matches!(outcome, Err(RecordingError::Timeout(_))),
        "卡死的 writer 必须以超时收场, 而不是永久挂住: {outcome:?}"
    );
    assert!(elapsed < SLACK, "控制往返超预算: {elapsed:?}");

    // 卡死 = 录制不可用, **不是**写入故障: 采集不得为此停止。
    assert!(hub.fault().is_none(), "卡死不得升级成故障");
    let health = hub.health();
    assert!(health.failed.is_some(), "「没有录制」必须对用户可见");
    assert!(health.enabled, "卡死不是用户关闭开关");
    assert!(!hub.is_bound(&port), "超时后 writer 必须被摘除");
}

/// 单连接纪律: 读路径必须经写线程的唯一连接, 而不是自己再开一个 DuckDB 实例。
/// 写线程不应答时读必须有界失败 — 若能自己开实例, 这里会「成功」并暴露第二条
/// 连接 (正是多实例互相 checkpoint、静默抹掉已提交写入的成因)。
#[test]
fn reads_go_through_the_writer_instead_of_opening_a_second_instance() {
    let (hub, port) = wedged_hub("read");
    assert!(
        hub.store().is_some_and(|store| store.reader().is_some()),
        "hub 交出的 store 必须带着写线程的读句柄"
    );

    let started = Instant::now();
    let outcome = hub.list_session_summaries();
    assert!(
        matches!(outcome, Err(RecordingError::Timeout(_))),
        "读必须经写线程并在预算内超时: {outcome:?}"
    );
    assert!(
        started.elapsed() < SLACK,
        "读超预算: {:?}",
        started.elapsed()
    );
    // 经 hub.store() 的读同样走写线程 (control-api 的会话/导出路径就是这么用的)。
    let store = hub.store().expect("注入的 writer 应给出 store");
    assert!(store.list_sessions().is_err());
    assert!(store.history_page("s", None, 0, 10, false).is_err());
    assert!(store.query_sql("SELECT 1", 1).is_err());
    assert!(store.delete_session("s").is_err());
    assert!(hub.database_info().is_err());
    assert!(hub.list_bindings("s").is_err());
    assert!(hub.query_sql("q1", "SELECT 1", 1).is_err());
    assert!(
        hub.is_bound(&port),
        "读超时不得摘掉 recorder (读失败不是写入故障)"
    );
    assert!(hub.fault().is_none(), "读失败不得升级成故障");
}

#[test]
fn a_wedged_writer_is_detached_on_stop_and_flush() {
    let (hub, _) = wedged_hub("stop");
    let started = Instant::now();
    let outcome = completed_within("hub.stop", move || hub.stop());
    assert!(
        matches!(outcome, Err(RecordingError::Timeout(_))),
        "关停卡死的 writer 必须报超时: {outcome:?}"
    );
    assert!(
        started.elapsed() < SLACK,
        "关停必须 detach 而不是无界 join: {:?}",
        started.elapsed()
    );

    let (hub, _) = wedged_hub("flush");
    let started = Instant::now();
    let outcome = completed_within("hub.flush", move || hub.flush());
    assert!(
        matches!(outcome, Err(RecordingError::Timeout(_))),
        "flush 卡死的 writer 必须报超时: {outcome:?}"
    );
    assert!(
        started.elapsed() < SLACK,
        "flush 超预算: {:?}",
        started.elapsed()
    );
}
