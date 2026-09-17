//! 波形缓冲区 Tauri 命令 — 同步查询入口 + 停止快照 + 原始导出
//!
//! 波形订阅统一走 [`display`] 的 `subscribe_data` 单一入口 (VNDP 协议);
//! 本模块保留缓冲区的拉取/清空/容量命令、`compute_frame_bytes` IPC、
//! Stop 波形快照 (create/query/release) 与原始样本读取/CSV 导出。
//! 快照/命令帧的实现在 [`control_api::data`] (与 MCP/CLI 共用), 此处只做
//! IPC 签名与错误类型适配。

use app::AppState;
use control_api::data;
use data_model::Result;
use std::io;
use tauri::State;
use waveform::{WaveformSeriesSelection, WaveformWindow};

pub use control_api::data::{CommandSendOutcome, WaveformSnapshotCreated};

/// IPC 错误类型适配: control-api 的 String 错误 → `data_model::Error`,
/// 文案原样透传 (前端展示契约不变)。
fn ipc_error(message: String) -> data_model::Error {
    io::Error::other(message).into()
}

/// 同步查询: 获取最近 N 个波形点 (source = 数据源 Protocol 节点 id)
#[tauri::command]
pub async fn get_recent_waveform(
    state: State<'_, AppState>,
    source: String,
    count: usize,
) -> Result<WaveformWindow> {
    let buf = state.data_plane.buffer_for(&source);
    let window = buf.lock().get_recent(count);
    Ok(window)
}

/// 同步查询: 获取时间窗口内的波形
///
/// start_ms / end_ms 为相对最新时间戳的偏移 (毫秒, 负数=过去)
#[tauri::command]
pub async fn get_waveform_window(
    state: State<'_, AppState>,
    source: String,
    start_ms: i64,
    end_ms: i64,
) -> Result<WaveformWindow> {
    let buf = state.data_plane.buffer_for(&source);
    let window = buf.lock().get_window(start_ms, end_ms);
    Ok(window)
}

/// 自动设置建议 (按钮触发的一次性计算) — 权威缓冲原始层/金字塔快照上
/// 周期检测 + 1-2-5 拟合, 全部在后端完成; 前端仅把建议合并进 axisConfig。
///
/// `channels` 为空表示全部通道; 计算含 FFT 自相关, 在阻塞线程执行。
#[tauri::command]
pub async fn compute_waveform_autoset(
    state: State<'_, AppState>,
    source: String,
    channels: Vec<usize>,
    derived: Vec<waveform::DerivedSeriesSelector>,
    shared_y: bool,
    current_v_per_div: Vec<f64>,
) -> Result<app::AutoSetSuggestion> {
    let buf = state.data_plane.buffer_for(&source);
    let suggestion = tokio::task::spawn_blocking(move || {
        app::compute_autoset_suggestion(&buf, &channels, &derived, shared_y, &current_v_per_div)
    })
    .await
    .map_err(|error| ipc_error(format!("自动设置计算任务失败: {error}")))?
    .ok_or_else(|| ipc_error("波形缓存为空, 无法自动设置".to_string()))?;
    Ok(suggestion)
}

/// 克隆当前原始环形缓存，供 Stop 后缩放和平移重采样。
#[tauri::command]
pub async fn create_waveform_snapshot(
    state: State<'_, AppState>,
    source: String,
) -> Result<WaveformSnapshotCreated> {
    let toolbox = control_api::Toolbox::from_state(state.inner());
    data::create_waveform_snapshot(&toolbox, &source)
        .await
        .map_err(ipc_error)
}

/// 从停止快照按新的时基和水平位置在后台重新生成 LTTB 视觉采样。
#[tauri::command]
pub async fn query_waveform_snapshot(
    state: State<'_, AppState>,
    snapshot_id: String,
    start_ms: f64,
    end_ms: f64,
    max_points: usize,
    selection: WaveformSeriesSelection,
) -> Result<WaveformWindow> {
    let toolbox = control_api::Toolbox::from_state(state.inner());
    data::query_waveform_snapshot(
        &toolbox,
        &snapshot_id,
        start_ms,
        end_ms,
        max_points,
        selection,
    )
    .await
    .map_err(ipc_error)
}

/// 释放停止快照占用的原始缓存。
#[tauri::command]
pub fn release_waveform_snapshot(state: State<'_, AppState>, snapshot_id: String) -> Result<()> {
    let toolbox = control_api::Toolbox::from_state(state.inner());
    data::release_waveform_snapshot(&toolbox, &snapshot_id);
    Ok(())
}

/// 读取绝对时间范围内的原始样本；用于有行数上限的剪贴板复制。
#[tauri::command]
pub async fn get_waveform_raw_range(
    state: State<'_, AppState>,
    source: String,
    snapshot_id: Option<String>,
    start_timestamp_us: u64,
    end_timestamp_us: u64,
    max_rows: usize,
    selection: WaveformSeriesSelection,
) -> Result<WaveformWindow> {
    let toolbox = control_api::Toolbox::from_state(state.inner());
    data::get_waveform_raw_range(
        &toolbox,
        &source,
        snapshot_id,
        start_timestamp_us,
        end_timestamp_us,
        max_rows,
        selection,
    )
    .await
    .map_err(ipc_error)
}

/// 按绝对时间范围将原始样本直接流式写入 CSV 文件。
#[tauri::command]
pub async fn export_waveform_csv(
    state: State<'_, AppState>,
    source: String,
    snapshot_id: Option<String>,
    start_timestamp_us: u64,
    end_timestamp_us: u64,
    selection: WaveformSeriesSelection,
    path: String,
) -> Result<usize> {
    let toolbox = control_api::Toolbox::from_state(state.inner());
    data::export_waveform_csv(
        &toolbox,
        &source,
        snapshot_id,
        start_timestamp_us,
        end_timestamp_us,
        selection,
        path,
    )
    .await
    .map_err(ipc_error)
}

/// 清空数据缓冲区 (source = 数据源 Protocol 节点 id)
#[tauri::command]
pub async fn clear_buffer(state: State<'_, AppState>, source: String) -> Result<()> {
    state.data_plane.buffer_for(&source).lock().clear();
    Ok(())
}

/// 设置缓冲区通道数 (清空已有数据)
#[tauri::command]
pub async fn set_buffer_channels(
    state: State<'_, AppState>,
    source: String,
    count: usize,
) -> Result<()> {
    state
        .data_plane
        .buffer_for(&source)
        .lock()
        .set_channels(count);
    Ok(())
}

/// 获取缓冲区当前通道数和点数
#[tauri::command]
pub async fn get_buffer_info(state: State<'_, AppState>, source: String) -> Result<(usize, usize)> {
    let buf = state.data_plane.buffer_for(&source);
    let b = buf.lock();
    Ok((b.channel_count(), b.point_count()))
}

/// 设置波形缓冲区最大点数
#[tauri::command]
pub async fn set_waveform_buffer_capacity(
    state: State<'_, AppState>,
    source: String,
    max_points: usize,
) -> Result<()> {
    state
        .data_plane
        .buffer_for(&source)
        .lock()
        .set_max_points(max_points);
    Ok(())
}

/// 命令发送帧字节打包 — 后端单一权威 (`compute_frame_bytes` IPC)
///
/// `frame`: 来自前端的 `CommandFrameDto` (camelCase 字段对齐前端 CommandFrame)
/// `inputs`: var_ref 端口的实时输入值 (按端口名索引, f64 表示)
///
/// 返回 `ComputedFrameDto { bytes: Vec<u8> | null, error: String | null, per_block }`。
/// 错误时 `bytes` 为 null 并附带 `块 #N: ...` 形式错误信息。
// serde IPC 契约使用 std hasher
#[allow(clippy::implicit_hasher)]
#[tauri::command]
pub async fn compute_command_frame_bytes(
    frame: pipeline::CommandFrameDto,
    inputs: std::collections::HashMap<String, f64>,
) -> pipeline::command_frame::ComputedFrameDto {
    data::compute_command_frame_bytes(&frame, &inputs)
}

/// 手动发送命令帧 — 统一发送内核 (预览 / 手动 / 自动同一条路)
///
/// 实现在 [`control_api::data::send_command_frame`] (与 MCP/CLI 共用):
/// 运行态门控 → 编码 → 沿全局 BytePlan 字节边路由。
/// 任一环节失败直接返回错误, 不入队不重试。
// serde IPC 契约使用 std hasher
#[allow(clippy::implicit_hasher)]
#[tauri::command]
pub async fn send_command_frame(
    state: State<'_, AppState>,
    widget_id: String,
    frame: pipeline::CommandFrameDto,
    inputs: std::collections::HashMap<String, f64>,
) -> Result<CommandSendOutcome> {
    let toolbox = control_api::Toolbox::from_state(state.inner());
    data::send_command_frame(&toolbox, &widget_id, &frame, &inputs)
        .await
        .map_err(ipc_error)
}
