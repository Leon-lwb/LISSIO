//! 线上帧契约 — WebSocket 双向消息与 HTTP-RPC 请求/响应。
//!
//! 契约原则与 `docs/architecture/exits.md` 一致: **命令名、参数名、错误 `kind`
//! 与事件名对前端保持不变**。这里定义的只是"如何把既有 IPC 语义装进帧", 不引入
//! 新的命令语义。
//!
//! 二进制流帧 (波形 / 包络 / 原始数据) 用独立头部 + 原样 payload:
//! `[u8 version][u8 format][u32 BE subscription_id][u32 BE payload_len][payload]`,
//! payload 与桌面 IPC `Channel` 的 `Raw` 逐字节相同, 前端解码器无需分支。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 二进制流帧版本 — 前端据此拒绝不认识的头部。
pub const BINARY_FRAME_VERSION: u8 = 1;
/// 二进制帧头部长度 (version + format + subscription id + payload len)。
pub const BINARY_FRAME_HEADER: usize = 10;

/// 服务端 → 客户端消息。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ServerMessage {
    /// 后端事件 (`events::BackendEventSink::emit_event`)。
    Event { event: String, payload: Value },
    /// Connection-scoped command event channel (AI streaming, etc.).
    Channel { id: u32, payload: Value },
    /// 系统通知 (`BackendEventSink::notify`) — Web 侧渲染为应用内提示。
    Notify {
        level: String,
        message: String,
        /// 产物下载 / 打开链接 (相对当前服务源)。只有导出类通知携带 —
        /// 浏览器无法落盘, 只能靠链接把文件交给用户。
        #[serde(skip_serializing_if = "Option::is_none")]
        url: Option<String>,
    },
    /// JSON 显示流推送 (`StreamPayload::Json` 的解析结果)。
    Stream { id: u32, payload: Value },
    /// 订阅已建立的回执 — 下发服务端分配的订阅 id。
    ///
    /// 回执先于该 id 的任何流帧发出, 客户端据此登记分流表, 不需要握手超时。
    Subscribed { id: u32 },
    /// 订阅已取消的回执。
    Unsubscribed { id: u32 },
    /// 单条 RPC 结果 (与 HTTP-RPC 响应同形)。
    Response {
        id: Value,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<Value>,
    },
    /// 协议级错误 (帧无法解析 / 订阅命令非法)。
    ///
    /// `id` 只在"某条订阅建立失败"时出现 — 客户端据此把失败归到具体订阅
    /// (其他协议级错误没有归属, 省略该字段)。
    Fault {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<u32>,
    },
}

impl ServerMessage {
    /// 无归属的协议级错误。
    pub fn fault(message: impl Into<String>) -> Self {
        Self::Fault {
            message: message.into(),
            id: None,
        }
    }

    /// 归属于某条订阅的建立失败 — 与桌面出口 `subscribe_data` 的 reject 同义。
    pub fn subscription_fault(id: u32, message: impl Into<String>) -> Self {
        Self::Fault {
            message: message.into(),
            id: Some(id),
        }
    }
}

/// 客户端 → 服务端消息。
///
/// 订阅 **不带 id**: id 由服务端在进程级命名空间分配并通过
/// [`ServerMessage::Subscribed`] 回执下发。`app::display` 的订阅表是全局的,
/// 让客户端自选 id 会在多连接间互相踢掉订阅。
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ClientMessage {
    /// 建立显示订阅 — `args` 为 `subscribe_data` 的帧内参数。
    Subscribe { args: Value },
    /// 取消显示订阅。
    Unsubscribe { id: u32 },
    /// 通过长连接执行命令 (与 HTTP-RPC 等价, 便于前端统一走一条通道)。
    Rpc {
        #[serde(default)]
        id: Value,
        cmd: String,
        #[serde(default)]
        args: Value,
    },
    /// 心跳 — 服务端回协议级 pong。
    Ping,
}

/// 单条 HTTP-RPC 请求 (支持数组批量提交)。
#[derive(Debug, Clone, Deserialize)]
pub struct RpcRequest {
    /// 调用方自定义关联 id (回显)。
    #[serde(default)]
    pub id: Value,
    pub cmd: String,
    #[serde(default)]
    pub args: Value,
}

/// 单条 HTTP-RPC 响应。
#[derive(Debug, Clone, Serialize)]
pub struct RpcResponse {
    pub id: Value,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
}

impl RpcResponse {
    /// 成功响应。
    pub const fn success(id: Value, result: Value) -> Self {
        Self {
            id,
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    /// 失败响应 — `error` 是 [`rpc_api::RpcError`] 的序列化形状。
    pub const fn failure(id: Value, error: Value) -> Self {
        Self {
            id,
            ok: false,
            result: None,
            error: Some(error),
        }
    }
}

/// `/api/v1/capabilities` 响应 — 前端据此隐藏本出口不支持的 UI。
#[derive(Debug, Clone, Serialize)]
pub struct Capabilities {
    /// 本出口已实现的命令名。
    pub supported: Vec<String>,
    /// 尚未接入的命令名 (前端可降级提示)。
    pub pending: Vec<String>,
    /// 桌面壳专有命令 (浏览器无等价能力)。
    pub desktop_only: Vec<String>,
    /// 出口协议版本 — 前端据此选择 transport 实现。
    pub protocol: &'static str,
}

/// 出口协议版本号。
pub const PROTOCOL_VERSION: &str = "lissio.web.v2";

/// 二进制流帧编码 — 头部 + 原样 payload。
pub fn encode_binary_frame(subscription_id: u32, payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(BINARY_FRAME_HEADER + payload.len());
    frame.push(BINARY_FRAME_VERSION);
    frame.push(1);
    frame.extend_from_slice(&subscription_id.to_be_bytes());
    // 头部长度字段是 u32: 单帧不可能超过 4 GiB (显示流按窗口分片推送)
    let len = u32::try_from(payload.len()).unwrap_or(u32::MAX);
    frame.extend_from_slice(&len.to_be_bytes());
    frame.extend_from_slice(payload);
    frame
}

#[cfg(test)]
mod tests {
    use super::{
        BINARY_FRAME_HEADER, BINARY_FRAME_VERSION, ClientMessage, RpcResponse, ServerMessage,
        encode_binary_frame,
    };
    use serde_json::json;

    #[test]
    fn binary_frame_header_layout_is_stable() {
        let frame = encode_binary_frame(7, &[0xAA, 0xBB, 0xCC]);
        assert_eq!(frame.len(), BINARY_FRAME_HEADER + 3);
        assert_eq!(frame[0], BINARY_FRAME_VERSION);
        assert_eq!(frame[1], 1, "json/binary format tag");
        assert_eq!(&frame[2..6], &7_u32.to_be_bytes());
        assert_eq!(&frame[6..10], &3_u32.to_be_bytes());
        assert_eq!(&frame[10..], &[0xAA, 0xBB, 0xCC]);
    }

    #[test]
    fn client_message_uses_lowercase_type_tag() {
        let parsed: ClientMessage =
            serde_json::from_value(json!({ "type": "unsubscribe", "id": 3 })).expect("解析应成功");
        assert!(matches!(parsed, ClientMessage::Unsubscribe { id: 3 }));
    }

    #[test]
    fn subscribe_frame_does_not_accept_client_chosen_id() {
        let parsed: ClientMessage = serde_json::from_value(json!({
            "type": "subscribe",
            "args": { "request": { "kind": "waveform" } }
        }))
        .expect("解析应成功");
        assert!(matches!(parsed, ClientMessage::Subscribe { .. }));
    }

    #[test]
    fn rpc_response_omits_empty_fields() {
        let ok = serde_json::to_value(RpcResponse::success(json!(1), json!({"a": 1})))
            .expect("序列化应成功");
        assert!(ok.get("error").is_none());
        let err = serde_json::to_value(RpcResponse::failure(json!(1), json!({"kind": "X"})))
            .expect("序列化应成功");
        assert!(err.get("result").is_none());
        assert_eq!(err["ok"], json!(false));
    }

    #[test]
    fn fault_is_attributable_only_when_it_concerns_a_subscription() {
        // 订阅建立失败: 客户端已先收到回执, 必须靠 id 把失败归到该订阅
        let subscription = serde_json::to_value(ServerMessage::subscription_fault(9, "boom"))
            .expect("序列化应成功");
        assert_eq!(subscription["type"], json!("fault"));
        assert_eq!(subscription["id"], json!(9));
        assert_eq!(subscription["message"], json!("boom"));

        // 帧级错误没有归属: 省略 id, 客户端只作日志
        let plain = serde_json::to_value(ServerMessage::fault("bad frame")).expect("序列化应成功");
        assert!(plain.get("id").is_none());
    }
}
