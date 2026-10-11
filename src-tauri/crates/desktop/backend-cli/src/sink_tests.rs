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
