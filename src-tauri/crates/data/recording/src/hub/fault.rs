//! 录制故障分类 — 决定一次写入错误是否真的破坏了采集契约。
//!
//! 只有**已受理批次无法落盘**才算契约被破坏。这条边界就是本模块存在的理由:
//! 曾经把正常背压 (写线程队列打满) 也升级成故障, 后果是 Windows 上「点开始
//! 只出几个字符、暂停也解不开」— 故障标记会一直粘着, 而运行控制每个评估批次
//! 之后都据此把工作区停回 Stopped, 于是每次「开始」都在一批数据内被打回。

use crate::RecordingError;

/// 录制契约故障 — 已受理的批次无法落盘。
///
/// 只有这一种情况才允许停止采集 (见 [`crate::RecordingHub::fault`])。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordingFault {
    reason: String,
}

impl RecordingFault {
    #[must_use]
    pub fn message(&self) -> &str {
        &self.reason
    }

    /// 由 writer 线程自报的失败原因构造 — 那条路径拿到的是字符串而不是错误值。
    #[must_use]
    pub(super) const fn from_message(reason: String) -> Self {
        Self { reason }
    }
}

impl std::fmt::Display for RecordingFault {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.reason)
    }
}

/// 一次写入错误的处置方式。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum FailureClass {
    /// 正常背压或图编辑竞态: 丢弃该批次并计数, 采集照常。
    Dropped,
    /// writer 无响应: 摘除 recorder 并报「录制不可用」, 采集照常。
    Unavailable,
    /// 录制契约被破坏: 已受理批次落不了盘, 采集必须停止。
    Contract,
}

#[must_use]
pub(super) const fn classify(error: &RecordingError) -> FailureClass {
    match error {
        // 队列打满、绑定在途变更都是瞬时状态, 不是故障。
        RecordingError::Backpressure | RecordingError::Invalid(_) => FailureClass::Dropped,
        // writer 卡住 / 录制本来就没建立起来: 这一段录制没了, 但采集与本机都还好。
        RecordingError::Timeout(_) | RecordingError::Unavailable(_) => FailureClass::Unavailable,
        // 下面这些意味着已受理的数据写不进去了。
        RecordingError::Database(_)
        | RecordingError::Io(_)
        | RecordingError::Corrupt(_)
        | RecordingError::Failed(_)
        | RecordingError::Closed => FailureClass::Contract,
    }
}

#[must_use]
pub(super) fn contract_fault(error: &RecordingError) -> Option<RecordingFault> {
    (classify(error) == FailureClass::Contract).then(|| RecordingFault {
        reason: error.to_string(),
    })
}

/// 在**已持有状态锁**时登记处置结果 — 不摘除 recorder (调用方正拿着它)。
pub(super) fn apply(state: &mut super::HubState, error: &RecordingError) {
    match classify(error) {
        FailureClass::Contract => state.fault = contract_fault(error),
        FailureClass::Unavailable => state.unavailable = Some(error.to_string()),
        FailureClass::Dropped => {}
    }
}

#[cfg(test)]
#[path = "fault_tests.rs"]
mod tests;
