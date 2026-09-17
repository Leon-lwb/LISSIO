//! 流水线参数、工作区运行控制与后台发送任务注册。
//!
//! 与桌面 IPC 的 `commands/pipeline` 同源: 钳制在
//! [`data_model::PipelineConfig::sanitized`], 运行切换在
//! `app::apply_workspace_run`, 本模块只做参数解包与事件广播。

use app::{CommandFrameDto, RunAction, SendMode, SendStatus, SendTask, apply_workspace_run};
use backend_host::BackendHost;
use data_model::{Error, PipelineConfig};
use error::ConfigError;
use events::emit_workspace_run;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

use crate::args::{RpcError, encode, ok, required};

/// 前端注册的后台自动发送任务 (Command widget 每个非手动帧一条)。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendTaskDto {
    widget_id: String,
    frame_id: String,
    mode: SendMode,
    #[serde(default)]
    interval_ms: u64,
    frame: CommandFrameDto,
}

/// 设置流水线参数 (提交值统一钳制到安全区间)。
pub fn set_pipeline_config(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let config: PipelineConfig = required(args, cmd, "config")?;
    let cfg = config.sanitized();
    let state = &host.state;
    state.data_plane.eval.bus.set_limits(app::RuntimeLimits {
        max_workers: cfg.max_workers,
        memory_budget_mb: cfg.memory_budget_mb,
        preview_fps_limit: cfg.preview_fps_limit,
        preview_bandwidth_mb_per_sec: cfg.preview_bandwidth_mb_per_sec,
    });
    log::info!("流水线参数已更新 (clamp 后): {cfg:?}");
    *state.pipeline_config.write() = cfg;
    ok()
}

/// 读取当前流水线参数。
pub fn get_pipeline_config(host: &BackendHost) -> Result<Value, RpcError> {
    encode(&*host.state.pipeline_config.read())
}

/// 工作区运行控制 — start / pause / stop, 广播 `workspace:run` 事件。
pub async fn workspace_run(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let action: RunAction = required(args, cmd, "action")?;
    let state = &host.state;
    let snapshot = apply_workspace_run(
        &state.transport,
        &state.data_plane,
        &state.stream_groups,
        action,
    )
    .await;
    emit_workspace_run(host.sink.as_ref(), &snapshot);
    encode(&snapshot)
}

/// 读取当前运行快照 (水合用, 不产生事件)。
pub fn get_workspace_run_state(host: &BackendHost) -> Result<Value, RpcError> {
    encode(&host.state.data_plane.eval.execution.snapshot())
}

/// 注册/替换某 Command widget 的全部自动发送任务 (空列表 = 注销)。
pub fn set_widget_send_tasks(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let widget_id: String = required(args, cmd, "widget_id")?;
    let tasks: Vec<SendTaskDto> = required(args, cmd, "tasks")?;
    let state = &host.state;
    if !state
        .data_plane
        .global_nodes
        .lock()
        .contains_key(&widget_id)
    {
        return Err(RpcError::domain(&Error::Config(
            ConfigError::NodeNotFound { node_id: widget_id },
        )));
    }
    let mut registered: Vec<SendTask> = Vec::with_capacity(tasks.len());
    for task in tasks {
        // 防御: widget_id 以后端参数为准, 载荷内不一致视为非法
        if task.widget_id != widget_id {
            return Err(RpcError::domain(&Error::Config(
                ConfigError::NodeNotFound {
                    node_id: task.widget_id,
                },
            )));
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
    encode(&count)
}

/// 自动发送任务状态表 (task_key → sent/skipped/error)。
pub fn get_send_task_status(host: &BackendHost) -> Result<Value, RpcError> {
    let status: HashMap<String, SendStatus> = host.state.data_plane.eval.send.lock().status_map();
    encode(&status)
}
