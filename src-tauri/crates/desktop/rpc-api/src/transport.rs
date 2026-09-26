//! 传输与协议操作 — 连接开闭 / 字节与文本发送 / 协议热更新 / CAN 帧。
//!
//! 命令体全部在 `app::AppState` (L3), 本模块只做参数解包与事件端口注入;
//! 与桌面 IPC 的 `commands/can_transport` 是同一份实现。

use backend_host::BackendHost;
use can::{CanFrame, CanFrameBatch};
use data_model::device_tree::NodeId;
use data_model::{TestDataConfig, WidgetBinding};
use schema_types::{ProtocolConfig, ProtocolSchema};
use serde_json::Value;

use crate::args::{RpcError, domain, encode, optional, required};

fn node_identity(args: &Value, cmd: &str) -> Result<NodeId, RpcError> {
    let value: String = required(args, cmd, "node_id")?;
    NodeId::new(value).map_err(|error| RpcError::invalid_args(cmd, error.to_string()))
}

/// 关闭设备连接 (node_id = 图中设备节点 id)。
pub async fn close_transport(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let node_id = node_identity(args, cmd)?;
    domain(
        host.state
            .close_transport(host.sink.as_ref(), &node_id)
            .await,
    )
}

/// 发送原始字节。
pub async fn send_raw(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let node_id = node_identity(args, cmd)?;
    let data: Vec<u8> = required(args, cmd, "data")?;
    domain(host.state.send_raw(&node_id, data).await)
}

/// 发送 UTF-8 文本 (按字节原样发送)。
pub async fn send_string(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let node_id = node_identity(args, cmd)?;
    let text: String = required(args, cmd, "text")?;
    domain(host.state.send_raw(&node_id, text.into_bytes()).await)
}

/// TextOut 手动发送 — 立即把图内当前文本发往目标 Transport。
pub async fn send_text_out_now(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let node_id: String = required(args, cmd, "node_id")?;
    domain(host.state.send_text_out_now(&node_id).await)
}

/// 发送控件值 (按绑定模式自动编码)。
pub async fn send_widget_value(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let node_id: String = required(args, cmd, "node_id")?;
    let protocol_node: Option<String> = optional(args, cmd, "protocol_node")?;
    let binding: WidgetBinding = required(args, cmd, "binding")?;
    let value: f32 = required(args, cmd, "value")?;
    domain(
        host.state
            .send_widget_value(&node_id, protocol_node, binding, value)
            .await,
    )
}

/// 协议回环 — 发送字节并立即捕获协议引擎解析结果 (调试用)。
pub async fn send_and_capture(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let node_id: String = required(args, cmd, "node_id")?;
    let protocol_node: String = required(args, cmd, "protocol_node")?;
    let data: Vec<u8> = required(args, cmd, "data")?;
    domain(
        host.state
            .send_and_capture(&node_id, &protocol_node, data)
            .await,
    )
}

/// 运行时热更新传输节点的链路协议 (无需重连)。
pub async fn update_transport_protocol(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let node_id: String = required(args, cmd, "node_id")?;
    let protocol: ProtocolConfig = required(args, cmd, "protocol")?;
    let schema: Option<ProtocolSchema> = optional(args, cmd, "schema")?;
    let test_data_config: Option<TestDataConfig> = optional(args, cmd, "test_data_config")?;
    domain(
        host.state
            .update_transport_protocol(&node_id, protocol, schema, test_data_config)
            .await,
    )
}

/// 设置指定 Protocol 节点的协议配置 (运行时覆盖)。
pub async fn set_protocol(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let node_id: String = required(args, cmd, "node_id")?;
    let config: ProtocolConfig = required(args, cmd, "config")?;
    domain(
        host.state
            .set_protocol(host.sink.as_ref(), &node_id, config)
            .await,
    )
}

/// 读取指定 Protocol 节点的当前协议配置。
pub async fn get_protocol(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let node_id: String = required(args, cmd, "node_id")?;
    domain(host.state.get_protocol(&node_id).await)
}

/// 读取自动检测到的通道数 (手动模式返回 null)。
pub async fn get_detected_channels(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let node_id: String = required(args, cmd, "node_id")?;
    domain(host.state.get_detected_channels(&node_id).await)
}

/// 发送 CAN 帧 (经指定/溯源 Protocol 节点引擎编码)。
pub async fn send_can_frame(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let node_id: String = required(args, cmd, "node_id")?;
    let protocol_node: Option<String> = optional(args, cmd, "protocol_node")?;
    let frame: CanFrame = required(args, cmd, "frame")?;
    domain(
        host.state
            .send_can_frame(&node_id, protocol_node, frame)
            .await,
    )
}

/// 同步查询最近 N 个 CAN 帧 (`seq: 0` = 非流式首屏快照)。
pub fn get_recent_can_frames(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let count: usize = required(args, cmd, "count")?;
    let frames = host.state.can_buffer.lock().get_recent(count);
    encode(&CanFrameBatch { seq: 0, frames })
}

/// 清空 CAN 帧缓冲区。
pub fn clear_can_buffer(host: &BackendHost) -> Result<Value, RpcError> {
    host.state.can_buffer.lock().clear();
    crate::args::ok()
}

/// 读取 CAN 帧缓冲区当前帧数。
pub fn get_can_buffer_info(host: &BackendHost) -> Result<Value, RpcError> {
    encode(&host.state.can_buffer.lock().len())
}
