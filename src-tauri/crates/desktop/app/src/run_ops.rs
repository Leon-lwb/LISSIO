//! 工作区运行控制编排 — acquisition 运行态同步 + 数据平面状态机切换。
//!
//! 层级: L3 app。Tauri 命令、MCP `run_workspace` 工具与 CLI 共用这一条编排:
//! 切换语义/状态重置在 [`pipeline::apply_run_action`], acquisition 运行态与之
//! 配对 (Start 在切换完成后置位, 保证读任务只在 Running 期间放行字节)。

use std::sync::Arc;

use acquisition::AcquisitionRuntime;
use pipeline::{DataPlaneState, RunAction, RunSnapshot, StreamGroups, apply_run_action};

/// 应用一个运行控制动作, 返回切换后的运行快照 (幂等: 目标态相同则原样返回)。
pub async fn apply_workspace_run(
    transport: &Arc<AcquisitionRuntime>,
    plane: &DataPlaneState,
    stream_groups: &StreamGroups,
    action: RunAction,
) -> RunSnapshot {
    let acquisition_state = match action {
        RunAction::Start => acquisition::AcquisitionRunState::Running,
        RunAction::Pause => acquisition::AcquisitionRunState::Paused,
        RunAction::Stop => acquisition::AcquisitionRunState::Stopped,
    };
    if !matches!(action, RunAction::Start) {
        transport.set_run_state(acquisition_state);
    }
    let snapshot = apply_run_action(plane, stream_groups, action).await;
    if matches!(action, RunAction::Start) {
        transport.set_run_state(acquisition_state);
    }
    snapshot
}
