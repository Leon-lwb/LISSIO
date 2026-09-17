//! 出口端口实现 — 后端事件广播与显示流推送。
//!
//! 两个端口都是既有契约的宿主侧实现 (桌面由 `TauriEventSink` /
//! `TauriChannelSink` 实现), 业务侧零改动:
//! - [`events::BackendEventSink`] → [`BroadcastEventSink`] (全局事件扇出到所有连接)
//! - [`app::display::StreamSink`] → [`WsStreamSink`] (每条订阅一个, id 由服务端分配)

use app::display::{StreamPayload, StreamSink};
use events::{BackendEventSink, NotifyLevel};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};

use crate::frames::ServerMessage;

/// 服务端 → 单条连接的出站帧。
#[derive(Debug, Clone)]
pub enum OutFrame {
    /// 结构化消息 (事件 / 通知 / 回执 / 响应)。
    Message(ServerMessage),
    /// JSON 显示流 — payload 已是序列化好的 `DisplayEvent`, 直接拼装避免二次解析。
    StreamJson { id: u32, json: String },
    /// 二进制显示流 (WWB1 / VNDP / VENV 原样透传)。
    StreamBinary { id: u32, payload: Vec<u8> },
    /// 协议层 pong — 回应客户端心跳, 不经 JSON 编码。
    Pong,
}

/// 后端事件端口 — 广播到全部活跃 WebSocket 连接。
///
/// 失败安全: 无订阅者时 `send` 返回错误, 直接忽略 (与 `TauriEventSink` 的
/// "前端未就绪时不失败" 语义一致); 热路径上不做任何等待。
#[derive(Clone)]
pub struct BroadcastEventSink {
    tx: broadcast::Sender<ServerMessage>,
}

impl BroadcastEventSink {
    /// 由广播发送端构造。
    pub const fn new(tx: broadcast::Sender<ServerMessage>) -> Self {
        Self { tx }
    }

    /// 构造共享端口句柄 (注入 `BackendHost::assemble`)。
    pub fn handle(tx: &broadcast::Sender<ServerMessage>) -> events::EventSinkHandle {
        Arc::new(Self::new(tx.clone()))
    }
}

impl BackendEventSink for BroadcastEventSink {
    fn emit_event(&self, event: &str, payload: Value) {
        let _ = self.tx.send(ServerMessage::Event {
            event: event.to_string(),
            payload,
        });
    }

    fn notify(&self, level: NotifyLevel, message: &str) {
        let level = match level {
            NotifyLevel::Info => "info",
            NotifyLevel::Error => "error",
        };
        let _ = self.tx.send(ServerMessage::Notify {
            level: level.to_string(),
            message: message.to_string(),
        });
    }
}

/// 显示流端口 — 一条逻辑订阅对应一个实例, 写入连接级出站队列。
///
/// `send` 返回 `false` 表示连接已关闭, 订阅循环据此退出 (与 Tauri `Channel`
/// 关闭语义一致), 因此不需要额外的超时兜底。
pub struct WsStreamSink {
    id: u32,
    tx: mpsc::UnboundedSender<OutFrame>,
}

impl WsStreamSink {
    /// 由订阅 id 与连接出站队列构造。
    pub const fn new(id: u32, tx: mpsc::UnboundedSender<OutFrame>) -> Self {
        Self { id, tx }
    }
}

impl StreamSink for WsStreamSink {
    fn id(&self) -> u32 {
        self.id
    }

    fn send(&self, payload: StreamPayload) -> bool {
        let frame = match payload {
            StreamPayload::Json(json) => OutFrame::StreamJson { id: self.id, json },
            StreamPayload::Binary(bytes) => OutFrame::StreamBinary {
                id: self.id,
                payload: bytes,
            },
        };
        self.tx.send(frame).is_ok()
    }
}
