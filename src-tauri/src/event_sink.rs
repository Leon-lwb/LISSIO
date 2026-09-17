//! Tauri 事件端口实现 — 把 [`BackendEventSink`] 映射到 `AppHandle` 事件与系统通知。
//!
//! 层级: L5 组合根。端口契约在 L1 [`events`] crate; 这里是唯一的 Tauri 实现,
//! 由命令层与 `.setup` 按需构造后注入后端。

use app::display::{StreamPayload, StreamSink};
use events::{BackendEventSink, EventSinkHandle, NotifyLevel};
use serde_json::Value;
use std::sync::Arc;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

/// 系统通知标题前缀。
const APP_TITLE: &str = "Lissio";

/// Tauri 事件端口 — 事件经 `AppHandle::emit` 推给前端, 通知走系统通知。
#[derive(Clone)]
pub struct TauriEventSink {
    app: AppHandle,
}

impl TauriEventSink {
    /// 构造。
    pub const fn new(app: AppHandle) -> Self {
        Self { app }
    }

    /// 构造共享端口句柄 (需要 `Arc<dyn BackendEventSink>` 的 API 用)。
    pub fn handle(app: &AppHandle) -> EventSinkHandle {
        Arc::new(Self::new(app.clone()))
    }
}

impl BackendEventSink for TauriEventSink {
    fn emit_event(&self, event: &str, payload: Value) {
        // 失败安全: 前端尚未就绪或已退出时 emit 失败不影响后端语义
        let _ = self.app.emit(event, payload);
    }

    fn notify(&self, level: NotifyLevel, message: &str) {
        let title = match level {
            NotifyLevel::Info => APP_TITLE.to_string(),
            NotifyLevel::Error => format!("{APP_TITLE} 错误"),
        };
        let _ = self
            .app
            .notification()
            .builder()
            .title(title)
            .body(message)
            .show();
    }
}

/// Tauri 流推送端口 — 显示订阅的 [`StreamSink`] 实现, 包装 IPC `Channel`。
///
/// payload 与 IPC 线上格式一一映射: `Json(String)` → `InvokeResponseBody::Json`,
/// `Binary(Vec<u8>)` → `InvokeResponseBody::Raw` (VNDP/VENV/WWB1 原样透传)。
pub struct TauriChannelSink {
    channel: Channel<InvokeResponseBody>,
}

impl TauriChannelSink {
    /// 构造共享端口 (订阅 API 统一收 `Arc<dyn StreamSink>`)。
    pub fn handle(channel: Channel<InvokeResponseBody>) -> Arc<dyn StreamSink> {
        Arc::new(Self { channel })
    }
}

impl StreamSink for TauriChannelSink {
    fn id(&self) -> u32 {
        self.channel.id()
    }

    fn send(&self, payload: StreamPayload) -> bool {
        let body = match payload {
            StreamPayload::Json(json) => InvokeResponseBody::Json(json),
            StreamPayload::Binary(bytes) => InvokeResponseBody::Raw(bytes),
        };
        self.channel.send(body).is_ok()
    }
}
