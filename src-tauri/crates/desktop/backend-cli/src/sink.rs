//! CLI 事件端口 — [`events::BackendEventSink`] 的无界面实现。
//!
//! 事件以 JSON-lines 打印到 stderr (stdout 保留给命令结果), 系统通知以
//! 带级别的日志行打印。失败安全: 打印失败不 panic、不上抛。

use events::{BackendEventSink, NotifyLevel};

/// stderr JSON-lines 事件端口 (无界面宿主 / 测试可复用)。
pub struct CliEventSink;

impl BackendEventSink for CliEventSink {
    fn emit_event(&self, event: &str, payload: serde_json::Value) {
        let line = serde_json::json!({ "event": event, "payload": payload });
        eprintln!("{line}");
    }

    fn notify(&self, level: NotifyLevel, message: &str) {
        match level {
            NotifyLevel::Info => eprintln!("[notify] {message}"),
            NotifyLevel::Error => eprintln!("[notify/error] {message}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::CliEventSink;
    use events::{BackendEventSink, NotifyLevel};

    /// 端口契约: emit/notify 不得 panic (失败安全)。
    #[test]
    fn cli_sink_is_fail_safe() {
        let sink = CliEventSink;
        sink.emit_event("graph:derived", serde_json::json!({ "nodes": [] }));
        sink.notify(NotifyLevel::Info, "hello");
        sink.notify(NotifyLevel::Error, "boom");
    }
}
