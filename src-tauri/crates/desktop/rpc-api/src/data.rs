//! 四域数据读取与调试工具 — CAN 负载 / 逻辑与解码缓冲 / 原始字节 / 触发器 /
//! 数据健康。
//!
//! 订阅 (波形 / 原始 / CAN / 逻辑) 不走本模块: 它由出口层的流推送通道承载
//! (桌面 IPC `Channel`, Web 出口 WebSocket), 见 `app::display::subscribe_data`。

use app::{TriggerMatchResult, TriggerMatcher, TriggerRuleDef};
use backend_host::BackendHost;
use can::CanLoadSnapshot;
use control_api::data;
use logic::{DecodedEventBatch, LogicSampleBatch};
use serde_json::Value;

use crate::args::{RpcError, encode, ok, optional, required};

// ============ 显示健康 / 背压 ============

/// 前端消费反馈 (缓冲字节数与渲染耗时)。
pub fn ack_data(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let subscription_id: u32 = required(args, cmd, "subscription_id")?;
    let sequence: u64 = required(args, cmd, "sequence")?;
    let buffered_bytes: usize = required(args, cmd, "buffered_bytes")?;
    let render_ms: f64 = required(args, cmd, "render_ms")?;
    crate::args::domain(app::display::ack_data(
        &host.state,
        subscription_id,
        sequence,
        buffered_bytes,
        render_ms,
    ))
}

/// 数据管道运行时健康快照。
pub fn get_data_health(host: &BackendHost) -> Result<Value, RpcError> {
    encode(&app::display::get_data_health(&host.state))
}

// ============ 逻辑分析仪 / 解码事件 ============

/// 同步查询最近 N 个逻辑采样。
pub fn get_recent_logic_samples(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let count: usize = required(args, cmd, "count")?;
    let samples = host.state.logic_buffer.lock().get_recent(count);
    encode(&LogicSampleBatch { seq: 0, samples })
}

/// 清空逻辑采样缓冲区。
pub fn clear_logic_buffer(host: &BackendHost) -> Result<Value, RpcError> {
    host.state.logic_buffer.lock().clear();
    ok()
}

/// 读取逻辑采样缓冲区当前数量。
pub fn get_logic_buffer_info(host: &BackendHost) -> Result<Value, RpcError> {
    encode(&host.state.logic_buffer.lock().len())
}

/// 同步查询最近 N 个解码事件。
pub fn get_recent_decoded_events(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let count: usize = required(args, cmd, "count")?;
    let events = host.state.decoded_buffer.lock().get_recent(count);
    encode(&DecodedEventBatch { seq: 0, events })
}

/// 清空解码事件缓冲区。
pub fn clear_decoded_buffer(host: &BackendHost) -> Result<Value, RpcError> {
    host.state.decoded_buffer.lock().clear();
    ok()
}

/// 读取解码事件缓冲区当前数量。
pub fn get_decoded_buffer_info(host: &BackendHost) -> Result<Value, RpcError> {
    encode(&host.state.decoded_buffer.lock().len())
}

// ============ 原始数据 ============

/// 清空原始数据收集器 (source 缺省 = 全部源)。
pub fn clear_raw_data_collector(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let source: Option<String> = optional(args, cmd, "source")?;
    data::clear_raw_data_collector(&host.toolbox, source.as_deref());
    ok()
}

// ============ CAN 负载统计 ============

/// 获取 CAN 负载统计快照。
pub fn get_can_load_stats(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let node_id: String = required(args, cmd, "node_id")?;
    let bitrate_bps: Option<u32> = optional(args, cmd, "bitrate_bps")?;
    let bitrate = app::can_bitrate_bps(&host.state, &node_id, bitrate_bps);
    let snapshot: CanLoadSnapshot = host.state.can_load_stats.lock().snapshot(bitrate);
    encode(&snapshot)
}

/// 设置 CAN 负载统计滑动窗口大小 (微秒)。
pub fn set_can_load_window(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let window_us: u64 = required(args, cmd, "window_us")?;
    host.state.can_load_stats.lock().set_window_us(window_us);
    ok()
}

/// 清空 CAN 负载统计。
pub fn clear_can_load_stats(host: &BackendHost) -> Result<Value, RpcError> {
    host.state.can_load_stats.lock().clear();
    ok()
}

/// 读取设备节点的当前 CAN 波特率与来源 (bps, source)。
pub fn get_current_can_bitrate(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let node_id: String = required(args, cmd, "node_id")?;
    let (bps, source) = app::can_bitrate_with_source(&host.state, &node_id);
    encode(&(bps, source))
}

// ============ 触发器 ============

/// 执行一次触发器匹配 (纯计算, 无状态)。
pub fn match_trigger_command(cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let rules: Vec<TriggerRuleDef> = required(args, cmd, "rules")?;
    let default_miss: f32 = required(args, cmd, "default_miss")?;
    let default_miss_text: String = required(args, cmd, "default_miss_text")?;
    let command: String = required(args, cmd, "command")?;
    let numeric: Option<f32> = optional(args, cmd, "numeric")?;
    let mut matcher = TriggerMatcher::new(rules, default_miss, default_miss_text);
    let result: TriggerMatchResult = matcher.match_input(&command, numeric);
    encode(&result)
}
