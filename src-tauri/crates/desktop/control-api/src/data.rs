//! 数据缓冲与命令帧 — 波形/原始数据缓冲操作、停止快照、命令帧编码与发送。
//!
//! 与 UI 命令层共用同一份实现: Tauri IPC 的 buffer/rawdata 命令体即本模块
//! 函数 (薄壳保留原签名与错误文案), MCP/CLI 直接调用。

use std::collections::HashMap;
use std::io::{BufWriter, Write};
use std::sync::atomic::Ordering;

use pipeline::data_plane::{byte_router, frame_dispatch};
use pipeline::decoder_feed::DecoderFeedCache;
use schema::command_frame::CommandFrameDto;
use schema::command_frame::ComputedFrameDto;
use serde::{Deserialize, Serialize};
use waveform::WaveformSeriesSelection;

use crate::toolbox::Toolbox;

/// 同步查询: 获取最近 N 个波形点 (source = 数据源 Protocol 节点 id)。
pub fn get_recent_waveform_window(
    tb: &Toolbox,
    source: &str,
    count: usize,
) -> Result<waveform::WaveformWindow, String> {
    let buf = tb.data_plane.buffer_for(source);
    Ok(buf.lock().get_recent(count))
}

/// 同步查询: 获取时间窗口内的波形 (start_ms/end_ms 相对最新时间戳, 负数=过去)。
pub fn get_waveform_window(
    tb: &Toolbox,
    source: &str,
    start_ms: i64,
    end_ms: i64,
) -> Result<waveform::WaveformWindow, String> {
    let buf = tb.data_plane.buffer_for(source);
    Ok(buf.lock().get_window(start_ms, end_ms))
}

/// 获取缓冲区当前通道数和点数。
pub fn get_buffer_size(tb: &Toolbox, source: &str) -> (usize, usize) {
    let buf = tb.data_plane.buffer_for(source);
    let b = buf.lock();
    (b.channel_count(), b.point_count())
}

/// 清空数据缓冲区 (source = 数据源 Protocol 节点 id)。
pub fn clear_buffer(tb: &Toolbox, source: &str) {
    tb.data_plane.buffer_for(source).lock().clear();
}

/// 设置缓冲区通道数 (清空已有数据)。
pub fn set_buffer_channels(tb: &Toolbox, source: &str, count: usize) {
    tb.data_plane.buffer_for(source).lock().set_channels(count);
}

/// 设置波形缓冲区最大点数。
pub fn set_waveform_buffer_capacity(tb: &Toolbox, source: &str, max_points: usize) {
    tb.data_plane
        .buffer_for(source)
        .lock()
        .set_max_points(max_points);
}

/// 设置原始数据收集器容量 (字节, source = 字节设备节点 id)。
pub fn set_rawdata_buffer_capacity(tb: &Toolbox, source: &str, capacity: usize) {
    tb.data_plane
        .raw_collector_for(source)
        .lock()
        .set_capacity(capacity);
}

/// 清空原始数据收集器 (source 指定的 Transport 源 / None = 全部源;
/// 各 FrameDecoder 节点旁路收集器总是同时清空)。
pub fn clear_raw_data_collector(tb: &Toolbox, source: Option<&str>) {
    match source {
        Some(s) => tb.data_plane.raw_collector_for(s).lock().clear(),
        None => {
            for c in tb.data_plane.raw_collectors.lock().values() {
                c.lock().clear();
            }
        }
    }
    for collector in tb.decoder_raw_collectors.lock().values() {
        collector.lock().clear();
    }
}

/// 设置 CAN 帧缓冲区最大帧数。
pub fn set_can_buffer_capacity(tb: &Toolbox, capacity: usize) {
    tb.can_buffer.lock().set_max_size(capacity);
}

/// 设置逻辑采样缓冲区最大采样数。
pub fn set_logic_buffer_capacity(tb: &Toolbox, capacity: usize) {
    tb.logic_buffer.lock().set_max_size(capacity);
}

/// `create_waveform_snapshot` 结果 — 快照 id + 缩略概览。
#[derive(Debug, Serialize)]
pub struct WaveformSnapshotCreated {
    pub snapshot_id: String,
    pub overview: waveform::WaveformWindow,
}

fn snapshot_memory_bytes(snapshots: &HashMap<String, app::WaveformSnapshot>) -> usize {
    snapshots
        .values()
        .map(|snapshot| snapshot.estimated_bytes)
        .fold(0usize, usize::saturating_add)
}

const fn snapshot_fits_memory_budget(used: usize, requested: usize, budget: usize) -> bool {
    match used.checked_add(requested) {
        Some(total) => total <= budget,
        None => false,
    }
}

/// 克隆当前原始环形缓存，供 Stop 后缩放和平移重采样 (受内存预算约束)。
pub async fn create_waveform_snapshot(
    tb: &Toolbox,
    source: &str,
) -> Result<WaveformSnapshotCreated, String> {
    let buffer = tb.data_plane.buffer_for(source);
    let (snapshot_buffer, estimated_bytes, overview) = tokio::task::spawn_blocking(move || {
        let snapshot = {
            let buffer = buffer.lock();
            if buffer.point_count() == 0 {
                return None;
            }
            buffer.clone()
        };
        let estimated_bytes = snapshot.estimated_bytes();
        let overview = snapshot.get_min_max(2_000);
        Some((snapshot, estimated_bytes, overview))
    })
    .await
    .map_err(|error| format!("创建停止快照失败: {error}"))?
    .ok_or_else(|| "当前波形缓存为空，无法创建停止快照".to_string())?;
    let budget_bytes = tb
        .pipeline_config
        .read()
        .memory_budget_mb
        .saturating_mul(1024 * 1024);
    let mut snapshots = tb.waveform_snapshots.lock();
    let used_bytes = snapshot_memory_bytes(&snapshots);
    if !snapshot_fits_memory_budget(used_bytes, estimated_bytes, budget_bytes) {
        let estimated_tenths_mb = estimated_bytes.saturating_mul(10) / (1024 * 1024);
        return Err(format!(
            "停止快照需要约 {}.{} MB，波形快照总量将超过当前 {} MB 内存预算",
            estimated_tenths_mb / 10,
            estimated_tenths_mb % 10,
            tb.pipeline_config.read().memory_budget_mb
        ));
    }
    let snapshot_id = format!(
        "waveform-{}",
        tb.next_waveform_snapshot_id.fetch_add(1, Ordering::Relaxed)
    );
    snapshots.insert(
        snapshot_id.clone(),
        app::WaveformSnapshot {
            source: source.to_string(),
            buffer: std::sync::Arc::new(snapshot_buffer),
            estimated_bytes,
        },
    );
    Ok(WaveformSnapshotCreated {
        snapshot_id,
        overview,
    })
}

/// 从停止快照按新的时基和水平位置在后台重新生成 LTTB 视觉采样。
pub async fn query_waveform_snapshot(
    tb: &Toolbox,
    snapshot_id: &str,
    start_ms: f64,
    end_ms: f64,
    max_points: usize,
    selection: WaveformSeriesSelection,
) -> Result<waveform::WaveformWindow, String> {
    let buffer = tb
        .waveform_snapshots
        .lock()
        .get(snapshot_id)
        .map(|snapshot| snapshot.buffer.clone())
        .ok_or_else(|| "波形停止快照已释放或不存在".to_string())?;
    tokio::task::spawn_blocking(move || {
        buffer.get_window_lttb(start_ms, end_ms, max_points, &selection)
    })
    .await
    .map_err(|error| format!("LTTB 后台计算失败: {error}"))
}

/// 释放停止快照占用的原始缓存。
pub fn release_waveform_snapshot(tb: &Toolbox, snapshot_id: &str) {
    tb.waveform_snapshots.lock().remove(snapshot_id);
}

/// 解析实时缓冲或停止快照缓冲 (snapshot_id 缺省时克隆实时缓存)。
async fn resolve_waveform_buffer(
    tb: &Toolbox,
    source: &str,
    snapshot_id: Option<String>,
) -> Result<std::sync::Arc<waveform::DataBuffer>, String> {
    if let Some(snapshot_id) = snapshot_id {
        let snapshots = tb.waveform_snapshots.lock();
        let snapshot = snapshots
            .get(&snapshot_id)
            .ok_or_else(|| "波形停止快照已释放或不存在".to_string())?;
        if snapshot.source != source {
            return Err("波形停止快照与当前数据源不匹配".to_string());
        }
        return Ok(snapshot.buffer.clone());
    }

    let live = tb.data_plane.buffer_for(source);
    tokio::task::spawn_blocking(move || std::sync::Arc::new(live.lock().clone()))
        .await
        .map_err(|error| format!("克隆实时波形缓存失败: {error}"))
}

fn checked_absolute_range(
    buffer: &waveform::DataBuffer,
    start_timestamp_us: u64,
    end_timestamp_us: u64,
) -> Result<(u64, u64), String> {
    let (oldest, latest) = buffer
        .time_bounds_us()
        .ok_or_else(|| "波形缓存为空".to_string())?;
    let requested_start = start_timestamp_us.min(end_timestamp_us);
    let requested_end = start_timestamp_us.max(end_timestamp_us);
    if requested_start < oldest || requested_end > latest {
        return Err("所选时间范围已超出原始环形缓存，未导出残缺数据".to_string());
    }
    Ok((requested_start, requested_end))
}

/// 读取绝对时间范围内的原始样本 (行数上限保护)。
pub async fn get_waveform_raw_range(
    tb: &Toolbox,
    source: &str,
    snapshot_id: Option<String>,
    start_timestamp_us: u64,
    end_timestamp_us: u64,
    max_rows: usize,
    selection: WaveformSeriesSelection,
) -> Result<waveform::WaveformWindow, String> {
    let buffer = resolve_waveform_buffer(tb, source, snapshot_id).await?;
    tokio::task::spawn_blocking(move || {
        let (requested_start, requested_end) =
            checked_absolute_range(&buffer, start_timestamp_us, end_timestamp_us)?;
        let window =
            buffer.get_window_raw_absolute_selected(requested_start, requested_end, &selection);
        if window.raw_window_points > max_rows {
            return Err(format!(
                "所选范围包含 {} 行，超过上限 {max_rows} 行；请使用文件导出",
                window.raw_window_points
            ));
        }
        Ok(window)
    })
    .await
    .map_err(|error| format!("读取原始波形失败: {error}"))?
}

/// 按绝对时间范围将原始样本直接流式写入 CSV 文件。返回写入行数。
pub async fn export_waveform_csv(
    tb: &Toolbox,
    source: &str,
    snapshot_id: Option<String>,
    start_timestamp_us: u64,
    end_timestamp_us: u64,
    selection: WaveformSeriesSelection,
    path: String,
) -> Result<usize, String> {
    let buffer = resolve_waveform_buffer(tb, source, snapshot_id).await?;
    tokio::task::spawn_blocking(move || {
        let (requested_start, requested_end) =
            checked_absolute_range(&buffer, start_timestamp_us, end_timestamp_us)?;
        let file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
        let mut writer = BufWriter::new(file);
        let rows = buffer
            .write_raw_csv(&mut writer, requested_start, requested_end, &selection)
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        Ok(rows)
    })
    .await
    .map_err(|error| format!("CSV 后台导出失败: {error}"))?
}

/// `send_command_frame` 结果 — 预览/手动/自动三路共用的统一发送内核输出。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSendOutcome {
    /// 权威字节 (与 UI 预览同内核产出; 编码失败时 bytes 为 null)
    pub computed: ComputedFrameDto,
    /// 字节路由命中的下游边数 (0 = 未连线)
    pub targets: usize,
    /// 字节是否成功派发到下游 (编码失败 / 未运行 / 无路由 / tx 失败时为 false)
    pub sent: bool,
    /// 发送层错误 (编码错误之外: 未运行 / 无路由 / 设备写入失败)
    pub error: Option<String>,
}

/// 命令发送帧字节打包 — 后端单一权威编码入口。
// serde 出口契约使用 std hasher (与 Tauri IPC 参数约定一致)
#[allow(clippy::implicit_hasher)]
pub fn compute_command_frame_bytes(
    frame: &CommandFrameDto,
    inputs: &HashMap<String, f64>,
) -> ComputedFrameDto {
    schema::command_frame::compute_frame_bytes(frame, inputs)
}

fn no_targets(error: &'static str) -> CommandSendOutcome {
    CommandSendOutcome {
        computed: ComputedFrameDto {
            bytes: None,
            error: None,
            per_block: Vec::new(),
        },
        targets: 0,
        sent: false,
        error: Some(error.to_string()),
    }
}

/// 手动发送命令帧 — 统一发送内核 (预览 / 手动 / 自动同一条路)。
///
/// 流程: 运行态门控 → 编码 (与预览、后台自动发送同一内核) → 沿全局 BytePlan
/// 字节边路由 (Transport.tx 真实发送 / FrameDecoder.in 喂入 / Protocol.in 回环)。
// serde 出口契约使用 std hasher (与 Tauri IPC 参数约定一致)
#[allow(clippy::implicit_hasher)]
pub async fn send_command_frame(
    tb: &Toolbox,
    widget_id: &str,
    frame: &CommandFrameDto,
    inputs: &HashMap<String, f64>,
) -> Result<CommandSendOutcome, String> {
    let plane = tb.data_plane.clone();

    // 运行态门控: 手动发送要求运行中 (与自动发送同门控), 失败直接返回
    if plane.eval.execution.ticket().is_none() {
        return Ok(no_targets(
            "工作区未运行: 手动发送要求运行态, 请先启动工作区",
        ));
    }
    let computed = compute_command_frame_bytes(frame, inputs);
    if computed.error.is_some() || computed.bytes.is_none() {
        return Ok(CommandSendOutcome {
            computed,
            targets: 0,
            sent: false,
            error: None,
        });
    }
    let bytes = computed.bytes.clone().unwrap_or_default();

    let targets = plane.byte_plan.lock().routes_for(widget_id).len();
    if targets == 0 {
        return Ok(no_targets("命令发送器未连线字节出口 (loopbackOut)"));
    }

    let mut cache = DecoderFeedCache::new();
    // boundary 读锁内复查运行态: 与切换互斥 — 校验通过后切换必须等发送完成,
    // 旧 epoch 字节不会跨切换发出
    let summary = {
        let _boundary = plane.eval.execution.boundary.read().await;
        if plane.eval.execution.ticket().is_none() {
            return Ok(no_targets(
                "工作区未运行: 手动发送要求运行态, 请先启动工作区",
            ));
        }
        byte_router::route_bytes(&plane, None, widget_id, &bytes, 0, &mut cache, None).await
    };
    if summary.decoders_fed {
        frame_dispatch::refresh_snapshot(&plane);
    }

    let error = if summary.tx_errors > 0 {
        Some(format!(
            "设备写入失败: {} 成功 / {} 失败",
            summary.tx_sends,
            summary.tx_sends + summary.tx_errors
        ))
    } else {
        None
    };
    Ok(CommandSendOutcome {
        sent: summary.tx_errors == 0,
        computed,
        targets,
        error,
    })
}

#[cfg(test)]
#[path = "data_tests.rs"]
mod tests;
