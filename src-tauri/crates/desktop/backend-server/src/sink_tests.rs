use super::*;

#[test]
fn closed_outbox_terminates_stream_subscription() {
    let outbox = Arc::new(ConnectionOutbox::new());
    let sink = WsStreamSink::new(7, outbox.clone());
    assert!(sink.send(StreamPayload::Json("first".into())));
    outbox.close();
    assert!(!sink.send(StreamPayload::Json("second".into())));
}
