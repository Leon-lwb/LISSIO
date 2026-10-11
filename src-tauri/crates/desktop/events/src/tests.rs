use super::*;
use std::sync::Mutex;

/// 记录型端口 — 断言派发行为 (测试专用)。
#[derive(Default)]
struct RecordingSink {
    events: Mutex<Vec<(String, Value)>>,
    notes: Mutex<Vec<(NotifyLevel, String)>>,
}

impl BackendEventSink for RecordingSink {
    fn emit_event(&self, event: &str, payload: Value) {
        self.events
            .lock()
            .expect("recording sink lock")
            .push((event.to_string(), payload));
    }

    fn notify(&self, level: NotifyLevel, message: &str) {
        self.notes
            .lock()
            .expect("recording sink lock")
            .push((level, message.to_string()));
    }
}

/// 事件契约: payload JSON 结构必须与前端约定严格一致
#[test]
fn transport_state_event_json_shape() {
    let v = serde_json::to_value(TransportStateEvent {
        node_id: "tp1".into(),
        state: ConnectionState::Connected,
    })
    .unwrap();
    assert_eq!(
        v,
        serde_json::json!({"node_id": "tp1", "state": "Connected"})
    );
}

#[test]
fn protocol_channels_detected_event_json_shape() {
    let v = serde_json::to_value(ProtocolChannelsDetectedEvent {
        node_id: "pt1".into(),
        channels: 3,
    })
    .unwrap();
    assert_eq!(v, serde_json::json!({"node_id": "pt1", "channels": 3}));
}

#[test]
fn transport_rx_event_json_shape() {
    let v = serde_json::to_value(TransportRxEvent {
        node_id: "tp1".into(),
        stats: TransportStats {
            rx_bytes: 10,
            tx_bytes: 2,
            rx_frames: 3,
            tx_frames: 1,
            rx_dropped: 0,
        },
    })
    .unwrap();
    assert_eq!(
        v,
        serde_json::json!({
            "node_id": "tp1",
            "stats": {
                "rx_bytes": 10,
                "tx_bytes": 2,
                "rx_frames": 3,
                "tx_frames": 1,
                "rx_dropped": 0,
            }
        })
    );
}

/// 端口派发: 事件名与 payload 原样到达实现方。
#[test]
fn emit_transport_state_reaches_sink() {
    let sink = RecordingSink::default();
    emit_transport_state(&sink, "tp1", ConnectionState::Disconnected);
    let events = sink.events.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].0, TRANSPORT_STATE_EVENT);
    assert_eq!(
        events[0].1,
        serde_json::json!({"node_id": "tp1", "state": "Disconnected"})
    );
}

/// 静默端口: 不产生任何副作用 (无界面后端路径)。
#[test]
fn null_sink_swallows_events() {
    let sink = NullEventSink;
    emit_transport_state(&sink, "tp1", ConnectionState::Connected);
    sink.notify(NotifyLevel::Error, "ignored");
}
