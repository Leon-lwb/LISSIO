//! 总开关、健康快照与故障登记。
//!
//! 这里是「数据库出问题不得波及采集」这条契约的唯一落点:
//! - `is_bound` 在关闭/无 writer 时恒为 false, 生产者自然停录;
//! - [`RecordingHub::fault`] 只对**已受理批次落不了盘**返回 `Some`;
//! - 打不开、卡住、被用户关掉都走 `unavailable`/`enabled`, 采集照常。

use std::path::Path;

use super::fault::{FailureClass, classify, contract_fault};
use super::{HubDatabase, RecordingFault, RecordingHub, spawn};
use crate::{
    DisplayBinding, RecordingError, RecordingHealth, RecordingLimits, RecordingStore, SessionInfo,
    SessionState,
};

impl RecordingHub {
    /// 数据库写入当前是否开启 (设置项, 默认开)。
    #[must_use]
    pub fn is_enabled(&self) -> bool {
        self.state.read().enabled
    }

    /// 以「关闭」状态登记数据库坐标 — 启动时开关已关走这条路, **不打开任何文件**。
    ///
    /// 坐标要记下来, 这样用户把开关打开时知道该去哪里建库, 也避免关闭期间
    /// 改目录设置被拒。
    pub fn disable_at(&self, path: impl AsRef<Path>, limits: RecordingLimits) {
        let mut state = self.state.write();
        state.recorder = None;
        state.guard = None;
        state.enabled = false;
        state.fault = None;
        state.unavailable = None;
        state.recovered = None;
        state.sequences.clear();
        state.database = Some(HubDatabase {
            path: path.as_ref().to_path_buf(),
            limits,
        });
    }

    /// 热关闭: 有界关闭在册 writer 并释放 DuckDB 文件句柄与实例守卫。
    ///
    /// Windows 上该句柄是强制锁 — 不释放, 另一个实例就永远打不开这个库。
    /// 采集侧不受影响: `is_bound` 立刻变 false, 运行控制照常。
    pub fn disable(&self) -> Result<(), RecordingError> {
        let recorder = self.state.write().recorder.take();
        if let Some(recorder) = recorder {
            recorder.shutdown()?;
        }
        let mut state = self.state.write();
        state.enabled = false;
        state.guard = None;
        state.fault = None;
        state.unavailable = None;
        state.recovered = None;
        state.sequences.clear();
        Ok(())
    }

    /// 热开启: 用登记过的坐标重新打开数据库, 并在其中新建会话继续录。
    pub fn enable(&self, initial: SessionState) -> Result<SessionInfo, RecordingError> {
        let (path, limits, active) = self.database_and_bindings()?;
        self.replace_recording(
            &path,
            limits,
            active,
            spawn::RecordingTarget::ContinueEmpty,
            initial,
        )
    }

    /// 只更新登记坐标, 不打开文件 — 关闭状态下改「数据库目录」走这里。
    pub fn remember_database(&self, path: impl AsRef<Path>, limits: RecordingLimits) {
        let mut state = self.state.write();
        state.database = Some(HubDatabase {
            path: path.as_ref().to_path_buf(),
            limits,
        });
    }

    /// 登记一次写入失败的处置: 只有破坏契约的失败才置 `fault`。
    ///
    /// 卡住的 writer (应答超时) 会被摘除并报「不可用」— 继续持有它只会把
    /// 换库与运行控制一起拖死, 而采集本身不该为磁盘陪葬。
    pub(super) fn note_failure(&self, error: &RecordingError) {
        match classify(error) {
            FailureClass::Contract => {
                self.state.write().fault = contract_fault(error);
            }
            FailureClass::Unavailable => {
                // 摘除在锁外进行: Arc 的 Drop 会跑有界 shutdown, 不能持锁。
                let wedged = self.state.write().recorder.take();
                drop(wedged);
                let mut state = self.state.write();
                state.fault = None;
                state.unavailable = Some(error.to_string());
            }
            FailureClass::Dropped => {}
        }
    }

    #[must_use]
    pub fn health(&self) -> RecordingHealth {
        let state = self.state.read();
        let mut health = state
            .recorder
            .as_ref()
            .map_or_else(RecordingHealth::default, |recorder| recorder.health());
        health.enabled = state.enabled;
        // 提示走独立通道: 绝不进 `failed`, 否则一次自动重建会被当成录制失败停掉采集。
        health.warning.clone_from(&state.recovered);
        if health.failed.is_none() {
            health.failed = state
                .fault
                .as_ref()
                .map(|fault| fault.message().to_string());
        }
        // 打不开 / 卡住 / 被关掉都不停止采集, 但必须保持可见 — 否则用户以为
        // 数据在被录制, 实际什么都没落盘。
        if health.failed.is_none() {
            health.failed.clone_from(&state.unavailable);
        }
        health
    }

    /// 读路径的统一失败原因 — 把**真实原因**带给调用方。
    ///
    /// 数据库打不开时原因存在 `unavailable`; 用户把总开关关掉是另一种明确状态。
    /// 两者都不该退化成笼统的 [`RecordingError::Closed`] — 那会让用户看到
    /// 「recording writer is closed」, 而真正可行动的信息 (文件损坏 / 开关关着)
    /// 只剩在健康报告里。
    pub(super) fn unavailable_error(&self) -> RecordingError {
        let state = self.state.read();
        if let Some(reason) = state.unavailable.clone() {
            return RecordingError::Unavailable(reason);
        }
        if !state.enabled {
            return RecordingError::Unavailable("the recording database is turned off".into());
        }
        RecordingError::Closed
    }

    /// writer 死掉之后读路径拿到的是通道层的 [`RecordingError::Closed`] — 换成健康
    /// 报告里的真实原因, 否则「writer is closed」会盖住写不下去的原因。
    pub(super) fn explain_closed(&self, error: RecordingError) -> RecordingError {
        if !matches!(error, RecordingError::Closed) {
            return error;
        }
        let state = self.state.read();
        if let Some(reason) = state.unavailable.clone() {
            return RecordingError::Unavailable(reason);
        }
        if let Some(reason) = state
            .recorder
            .as_ref()
            .and_then(|recorder| recorder.health().failed)
        {
            return RecordingError::Unavailable(reason);
        }
        error
    }

    /// 采集门控依据 — 只有**已受理批次落不了盘**才算录制契约被破坏。
    ///
    /// 返回 `None` 的情况一律不得停止采集: 数据库打不开、writer 卡住、用户
    /// 关掉开关、队列一时打满, 都是「没有录制」而不是「录制失败」。
    #[must_use]
    pub fn fault(&self) -> Option<RecordingFault> {
        let state = self.state.read();
        state.fault.clone().or_else(|| {
            state
                .recorder
                .as_ref()
                .and_then(|recorder| recorder.health().failed)
                .map(RecordingFault::from_message)
        })
    }

    #[must_use]
    pub fn store(&self) -> Option<RecordingStore> {
        self.state
            .read()
            .recorder
            .as_ref()
            .map(|recorder| recorder.store().clone())
    }

    /// 当前登记的数据库文件路径 (未登记过则为 `None`)。
    #[must_use]
    pub fn database_path(&self) -> Option<std::path::PathBuf> {
        self.state
            .read()
            .database
            .as_ref()
            .map(|database| database.path.clone())
    }

    /// 当前在册显示绑定 — 供关闭/开启之间保留绑定关系。
    #[must_use]
    pub fn active_bindings(&self) -> Vec<DisplayBinding> {
        self.state.read().active.values().cloned().collect()
    }
}
