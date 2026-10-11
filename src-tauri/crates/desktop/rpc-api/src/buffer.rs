//! 波形缓冲与停止快照 — 清空 / 容量 / 通道数 / 自动设置 / 快照与原始区间读取。
//!
//! 快照与原始区间的实现对全部出口共享 ([`control_api::data`]); 本模块只做参数
//! 解包。IPC 路径的 `String` 错误被映射为 `error::AppError` 文案透传, 此处
//! 保持同样的文案与 `kind` 约定。

use backend_host::BackendHost;
use control_api::data;
use serde_json::Value;
use waveform::{DerivedSeriesSelector, WaveformSeriesSelection};

use crate::args::{RpcError, encode, ok, required, text};

/// 清空数据缓冲区 (source = 数据源 Protocol 节点 id)。
pub fn clear_buffer(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let source: String = required(args, cmd, "source")?;
    data::clear_buffer(&host.state, &source);
    ok()
}

/// 设置缓冲区通道数 (清空已有数据)。
pub fn set_buffer_channels(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let source: String = required(args, cmd, "source")?;
    let count: usize = required(args, cmd, "count")?;
    data::set_buffer_channels(&host.state, &source, count);
    ok()
}

/// 获取缓冲区当前 (通道数, 点数)。
pub fn get_buffer_info(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let source: String = required(args, cmd, "source")?;
    encode(&data::get_buffer_size(&host.state, &source))
}

/// 设置波形缓冲区最大点数。
pub fn set_waveform_buffer_capacity(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let source: String = required(args, cmd, "source")?;
    let max_points: usize = required(args, cmd, "max_points")?;
    data::set_waveform_buffer_capacity(&host.state, &source, max_points);
    ok()
}

/// 设置原始数据收集器容量 (字节)。
pub fn set_rawdata_buffer_capacity(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let source: String = required(args, cmd, "source")?;
    let capacity: usize = required(args, cmd, "capacity")?;
    data::set_rawdata_buffer_capacity(&host.state, &source, capacity);
    ok()
}

/// 设置 CAN 帧缓冲区最大帧数。
pub fn set_can_buffer_capacity(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let capacity: usize = required(args, cmd, "capacity")?;
    data::set_can_buffer_capacity(&host.state, capacity);
    ok()
}

/// 设置逻辑采样缓冲区最大采样数。
pub fn set_logic_buffer_capacity(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let capacity: usize = required(args, cmd, "capacity")?;
    data::set_logic_buffer_capacity(&host.state, capacity);
    ok()
}

/// 自动设置建议 — 权威缓冲上做周期检测 + 1-2-5 拟合 (阻塞线程执行)。
pub async fn compute_waveform_autoset(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let source: String = required(args, cmd, "source")?;
    let channels: Vec<usize> = required(args, cmd, "channels")?;
    let derived: Vec<DerivedSeriesSelector> = required(args, cmd, "derived")?;
    let shared_y: bool = required(args, cmd, "shared_y")?;
    let current_v_per_div: Vec<f64> = required(args, cmd, "current_v_per_div")?;

    let buffer = host.state.data_plane.buffer_for(&source);
    let suggestion = tokio::task::spawn_blocking(move || {
        app::compute_autoset_suggestion(&buffer, &channels, &derived, shared_y, &current_v_per_div)
    })
    .await
    .map_err(|error| RpcError::text(format!("自动设置计算任务失败: {error}")))?
    .ok_or_else(|| RpcError::text("波形缓存为空, 无法自动设置".to_string()))?;
    encode(&suggestion)
}

/// 克隆当前原始环形缓存为停止快照。
pub async fn create_waveform_snapshot(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let source: String = required(args, cmd, "source")?;
    text(data::create_waveform_snapshot(&host.state, &source).await)
}

/// 从停止快照按新时基重新生成 LTTB 视觉采样。
pub async fn query_waveform_snapshot(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let snapshot_id: String = required(args, cmd, "snapshot_id")?;
    let start_ms: f64 = required(args, cmd, "start_ms")?;
    let end_ms: f64 = required(args, cmd, "end_ms")?;
    let max_points: usize = required(args, cmd, "max_points")?;
    let selection: WaveformSeriesSelection = required(args, cmd, "selection")?;
    text(
        data::query_waveform_snapshot(
            &host.state,
            &snapshot_id,
            start_ms,
            end_ms,
            max_points,
            selection,
        )
        .await,
    )
}

/// 释放停止快照占用的原始缓存。
pub fn release_waveform_snapshot(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let snapshot_id: String = required(args, cmd, "snapshot_id")?;
    data::release_waveform_snapshot(&host.state, &snapshot_id);
    ok()
}

/// 读取绝对时间范围内的原始样本 (有行数上限的剪贴板复制)。
#[allow(clippy::too_many_arguments)]
pub async fn get_waveform_raw_range(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let source: String = required(args, cmd, "source")?;
    let snapshot_id: Option<String> = crate::args::optional(args, cmd, "snapshot_id")?;
    let start_timestamp_us: u64 = required(args, cmd, "start_timestamp_us")?;
    let end_timestamp_us: u64 = required(args, cmd, "end_timestamp_us")?;
    let max_rows: usize = required(args, cmd, "max_rows")?;
    let selection: WaveformSeriesSelection = required(args, cmd, "selection")?;
    text(
        data::get_waveform_raw_range(
            &host.state,
            &source,
            snapshot_id,
            start_timestamp_us,
            end_timestamp_us,
            max_rows,
            selection,
        )
        .await,
    )
}

/// 命令发送帧字节打包 — 后端单一权威 (预览专用入口)。
pub fn compute_command_frame_bytes(cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let frame: schema::command_frame::CommandFrameDto = required(args, cmd, "frame")?;
    let inputs: std::collections::HashMap<String, f64> = required(args, cmd, "inputs")?;
    encode(&data::compute_command_frame_bytes(&frame, &inputs))
}

/// 手动发送命令帧 — 统一发送内核 (运行态门控 → 编码 → 字节边下发)。
pub async fn send_command_frame(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let widget_id: String = required(args, cmd, "widget_id")?;
    let frame: schema::command_frame::CommandFrameDto = required(args, cmd, "frame")?;
    let inputs: std::collections::HashMap<String, f64> = required(args, cmd, "inputs")?;
    text(data::send_command_frame(&host.state, &widget_id, &frame, &inputs).await)
}
