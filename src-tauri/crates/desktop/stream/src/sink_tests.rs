use super::{StreamPayload, StreamSink};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

/// 记录型端口 — 端口契约测试与无界面测试用。
#[derive(Default)]
struct RecordingSink {
    id: AtomicU32,
    payloads: Mutex<Vec<StreamPayload>>,
    pub(crate) fail_after: Option<usize>,
}

impl RecordingSink {
    fn new(id: u32) -> Self {
        Self {
            id: AtomicU32::new(id),
            ..Default::default()
        }
    }

    fn payloads(&self) -> Vec<StreamPayload> {
        self.payloads.lock().expect("recording sink lock").clone()
    }
}

impl StreamSink for RecordingSink {
    fn id(&self) -> u32 {
        self.id.load(Ordering::Relaxed)
    }

    fn send(&self, payload: StreamPayload) -> bool {
        let mut payloads = self.payloads.lock().expect("recording sink lock");
        if let Some(limit) = self.fail_after
            && payloads.len() >= limit
        {
            return false;
        }
        payloads.push(payload);
        true
    }
}

/// 端口契约: id 稳定、payload 原样到达、失败语义可表达。
#[test]
fn stream_sink_contract() {
    let sink = Arc::new(RecordingSink::new(7));
    assert_eq!(sink.id(), 7);
    assert!(sink.send(StreamPayload::Json("{\"k\":1}".into())));
    assert!(sink.send(StreamPayload::Binary(vec![1, 2, 3])));
    let payloads = sink.payloads();
    assert_eq!(payloads.len(), 2);
    assert!(matches!(payloads[0], StreamPayload::Json(ref s) if s == "{\"k\":1}"));
    assert!(matches!(payloads[1], StreamPayload::Binary(ref b) if b == &[1, 2, 3]));

    let failing = Arc::new(RecordingSink {
        fail_after: Some(1),
        ..RecordingSink::new(1)
    });
    assert!(failing.send(StreamPayload::Json("{}".into())));
    assert!(!failing.send(StreamPayload::Json("{}".into())));
}
