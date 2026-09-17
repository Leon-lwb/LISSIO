//! 工作区运行控制与后台发送任务注册 Tauri 命令。
//!
//! 层级: L4 cmd — Tauri IPC 薄适配; 切换语义与状态重置都在
//! `pipeline::run_control::apply_run_action`, 本层只做取状态 + 调用 + 事件广播。

use std::collections::HashMap;

use app::AppState;
use app::CommandFrameDto;
use app::apply_workspace_run;
use app::{RunAction, RunSnapshot};
use app::{SendMode, SendStatus, SendTask};
use data_model::{Error, Result};
use error::ConfigError;
use events::emit_workspace_run;
use serde::Deserialize;
use tauri::{AppHandle, State};

/// 工作区运行控制 — start (启动/恢复) / pause / stop。
///
/// 幂等: 目标态与当前态相同时不推进 epoch, 原样返回快照。
/// 返回/事件载荷为 [`RunSnapshot`] (`{state, epoch}`), 前端契约不变。
#[tauri::command]
pub async fn workspace_run(
    app: AppHandle,
    state: State<'_, AppState>,
    acquisition: State<'_, std::sync::Arc<acquisition::AcquisitionRuntime>>,
    action: RunAction,
) -> Result<RunSnapshot> {
    let snapshot = apply_workspace_run(
        &acquisition,
        &state.data_plane,
        &state.stream_groups,
        action,
    )
    .await;
    let sink = crate::event_sink::TauriEventSink::new(app);
    emit_workspace_run(&sink, &snapshot);
    Ok(snapshot)
}

/// 读取当前运行快照 (前端水合用 — 不产生事件)
#[tauri::command]
pub fn get_workspace_run_state(state: State<'_, AppState>) -> Result<RunSnapshot> {
    Ok(state.data_plane.eval.execution.snapshot())
}

/// 前端注册的后台自动发送任务 (Command widget 每个非手动帧一条)
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendTaskDto {
    pub widget_id: String,
    pub frame_id: String,
    pub mode: SendMode,
    #[serde(default)]
    pub interval_ms: u64,
    pub frame: CommandFrameDto,
}

/// 注册/替换某 Command widget 的全部自动发送任务 (空列表 = 注销)。
///
/// 前端在帧配置变化与组件卸载时调用 — 发送触发完全在 Rust 侧 ticker,
/// 前端不再持有任何定时器。Manual 模式的帧不入注册表 (手动发送走
/// `send_command_frame` 统一内核)。
#[tauri::command]
pub fn set_widget_send_tasks(
    state: State<'_, AppState>,
    widget_id: String,
    tasks: Vec<SendTaskDto>,
) -> Result<usize> {
    if !state
        .data_plane
        .global_nodes
        .lock()
        .contains_key(&widget_id)
    {
        return Err(Error::Config(ConfigError::NodeNotFound {
            node_id: widget_id,
        }));
    }
    let mut registered: Vec<SendTask> = Vec::with_capacity(tasks.len());
    for task in tasks {
        // 防御: widget_id 以后端参数为准, 载荷内不一致视为非法
        if task.widget_id != widget_id {
            return Err(Error::Config(ConfigError::NodeNotFound {
                node_id: task.widget_id,
            }));
        }
        registered.push(SendTask {
            widget_id: widget_id.clone(),
            frame_id: task.frame_id,
            frame: task.frame,
            mode: task.mode,
            interval_ms: task.interval_ms,
        });
    }
    let count = registered.len();
    state
        .data_plane
        .eval
        .send
        .lock()
        .set_widget_tasks(&widget_id, registered);
    Ok(count)
}

/// 自动发送任务状态表 (task_key → sent/skipped/error) — 调试与状态面板用
#[tauri::command]
pub fn get_send_task_status(state: State<'_, AppState>) -> Result<HashMap<String, SendStatus>> {
    Ok(state.data_plane.eval.send.lock().status_map())
}
