//! 工作区运行控制 — 启动 / 暂停 / 停止的状态机与副作用重置。
//!
//! 切换纪律 (与 [`crate::execution::ExecutionControl::boundary`] 契约一致):
//! 持写锁推进状态 + 完成全部依赖状态重置 — 读侧 (评估批次 / 字节路由 /
//! 发送 IO) 持读锁跨越异步段, 因此切换不可能与在途求值或设备写入交错,
//! 旧 epoch 的异步结果无法在切换后发布。
//!
//! 语义 (对应工作区运行契约):
//! - 暂停: 停止自动发送与设备写, 数据链继续 — 字节照常解析并写入波形/原始
//!   数据/CAN/逻辑缓存与录制, 图求值不停; 只复位发送簿记 (暂停期间的变更不补发)
//! - 恢复/启动: 从停止启动建立新流序列 (组序号归零) 并复位全部连续性状态;
//!   从暂停恢复保持数据连续 — 不重建流序列、不重置解析器与瞬时状态
//! - 停止: 硬门控 — 在途字节直接丢弃且不进入任何缓存, 清空已解析未评估队列
//!   与自动发送任务注册表; 已有缓存保留, 由展示层冻结

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use parking_lot::Mutex;

use crate::eval_state::StreamGroupState;
use crate::execution::{RunAction, RunSnapshot, RunState};
use crate::{DataPlaneState, graph_eval};

/// 流订阅组注册表类型 — AppState.stream_groups 的共享句柄
pub type StreamGroups = Arc<Mutex<HashMap<String, StreamGroupState>>>;

/// 应用一个运行控制动作, 返回切换后的运行快照 (幂等: 目标态相同则原样返回)。
///
/// 停止态收到 `Pause` 也是 no-op: 暂停语义建立在"数据链连续"之上, 从未启动
/// 的停止态没有可暂停的采集 (界面禁用该按钮, MCP/CLI 直达时同样收敛)。
pub async fn apply_run_action(
    plane: &DataPlaneState,
    stream_groups: &StreamGroups,
    action: RunAction,
) -> RunSnapshot {
    let execution = &plane.eval.execution;
    let target = match action {
        RunAction::Start => RunState::Running,
        RunAction::Pause => RunState::Paused,
        RunAction::Stop => RunState::Stopped,
    };
    let current = execution.snapshot();
    if current.state == target || (current.state == RunState::Stopped && target == RunState::Paused)
    {
        return current;
    }

    // 写锁内完成: 状态推进 + 队列/连续性/发送簿记重置 (与在途评估批次互斥)
    let snapshot = {
        let _guard = execution.boundary.write().await;
        let snapshot = execution.transition(target);
        match (current.state, target) {
            // 进入 Paused: 数据链继续 (不清评估队列、不复位解析器), 只复位发送
            // 簿记 (任务定义保留): 恢复后 OnChange 重建基线, Timer 从下个周期
            // 起算 — 暂停期间的变更不补发
            (_, RunState::Paused) => {
                plane.eval.send.lock().reset_schedules();
            }
            // 从 Stopped 启动: 新流序列 + 全部连续性状态复位
            (RunState::Stopped, RunState::Running) => {
                let dropped = plane.clear_all_eval_queues();
                if dropped > 0 {
                    log::debug!("工作区启动: 丢弃切换前评估队列积压 {dropped} 帧");
                }
                for group in stream_groups.lock().values() {
                    group.seq.store(0, Ordering::Release);
                }
                graph_eval::reset_all_transient_state(&plane.eval);
                plane.reset_protocol_parsers();
                plane.eval.send.lock().reset_schedules();
            }
            // 从 Paused 恢复: 暂停期数据没有丢, 保持连续 — 只复位发送簿记
            (RunState::Paused, RunState::Running) => {
                plane.eval.send.lock().reset_schedules();
            }
            // 进入 Stopped: 硬门控 (读任务丢弃在途字节) + 清空评估队列 +
            // 待发送任务注册表
            (_, RunState::Stopped) => {
                let dropped = plane.clear_all_eval_queues();
                if dropped > 0 {
                    log::debug!("工作区停止: 丢弃评估队列积压 {dropped} 帧");
                }
                let mut send = plane.eval.send.lock();
                send.reset_schedules();
                send.clear();
            }
            // 同态已在函数开头返回, 此臂仅为穷尽性
            (RunState::Running, RunState::Running) => {}
        }
        snapshot
    };
    log::info!(
        "工作区运行状态: {:?} -> {:?} (epoch {})",
        current.state,
        snapshot.state,
        snapshot.epoch
    );
    let recording_state = match target {
        RunState::Running => recording::SessionState::Running,
        // 暂停期间数据链与录制都在继续, 会话状态反映实际写入
        RunState::Paused => recording::SessionState::Running,
        RunState::Stopped => recording::SessionState::Stopped,
    };
    if let Err(error) = plane.eval.recording.set_state(recording_state) {
        log::error!("recording state transition failed: {error}");
    }
    snapshot
}
