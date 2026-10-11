//! 出口端口实现 — 后端事件广播与显示流推送。
//!
//! 两个端口都是既有契约的宿主侧实现 (桌面由 `TauriEventSink` /
//! `TauriChannelSink` 实现), 业务侧零改动:
//! - [`events::BackendEventSink`] → [`BroadcastEventSink`] (全局事件扇出到所有连接)
//! - [`stream::sink::StreamSink`] → [`WsStreamSink`] (每条订阅一个, id 由服务端分配)

use events::{BackendEventSink, NotifyLevel};
use serde_json::Value;
use std::sync::Arc;
use stream::sink::{StreamPayload, StreamSink};
use tokio::sync::broadcast;

use crate::frames::ServerMessage;
pub use crate::outbox::{ConnectionOutbox, OutFrame, OutboxStats};

/// 后端事件端口 — 广播到全部活跃 WebSocket 连接。
///
/// 失败安全: 无订阅者时 `send` 返回错误, 直接忽略 (与 `TauriEventSink` 的
/// "前端未就绪时不失败" 语义一致); 热路径上不做任何等待。
#[derive(Clone)]
pub struct BroadcastEventSink {
    tx: broadcast::Sender<ServerMessage>,
}

/// A request/connection-scoped event sink. Unlike `BroadcastEventSink`, this
/// is used by frontend-hosted AI tools and must never fan out to other clients.
#[derive(Clone)]
pub struct ConnectionEventSink {
    outbox: Arc<ConnectionOutbox>,
}

impl ConnectionEventSink {
    pub fn handle(outbox: &Arc<ConnectionOutbox>) -> events::EventSinkHandle {
        Arc::new(Self {
            outbox: outbox.clone(),
        })
    }
}

impl BackendEventSink for ConnectionEventSink {
    fn emit_event(&self, event: &str, payload: Value) {
        let _ = self
            .outbox
            .try_send_control_lossy(OutFrame::Message(ServerMessage::Event {
                event: event.to_string(),
                payload,
            }));
    }

    fn notify(&self, level: NotifyLevel, message: &str) {
        let _ = self
            .outbox
            .try_send_control_lossy(OutFrame::Message(ServerMessage::Notify {
                level: notify_level(level).to_string(),
                message: message.to_string(),
                url: None,
            }));
    }
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
        let _ = self.tx.send(ServerMessage::Notify {
            level: notify_level(level).to_string(),
            message: message.to_string(),
            url: None,
        });
    }

    fn notify_with_url(&self, level: NotifyLevel, message: &str, url: &str) {
        let _ = self.tx.send(ServerMessage::Notify {
            level: notify_level(level).to_string(),
            message: message.to_string(),
            url: Some(url.to_string()),
        });
    }
}

/// 通知级别 → 线上字符串。
const fn notify_level(level: NotifyLevel) -> &'static str {
    match level {
        NotifyLevel::Info => "info",
        NotifyLevel::Error => "error",
    }
}

/// 显示流端口 — 一条逻辑订阅对应一个实例, 写入连接级有界出站队列。
///
/// `send` 返回 `false` 表示连接已关闭, 订阅循环据此退出。队列满时只丢弃当前
/// 预览帧并继续订阅；显示流是可丢弃数据面，不能因慢消费者反向放大服务端内存。
pub struct WsStreamSink {
    id: u32,
    outbox: Arc<ConnectionOutbox>,
}

impl WsStreamSink {
    /// 由订阅 id 与连接出站队列构造。
    pub const fn new(id: u32, outbox: Arc<ConnectionOutbox>) -> Self {
        Self { id, outbox }
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
        self.outbox.try_send_stream_lossy(frame)
    }
}

#[cfg(test)]
#[path = "sink_tests.rs"]
mod tests;
