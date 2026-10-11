use super::*;

#[test]
fn envelope_serialization_is_stable_and_tag_free() {
    let envelope = FlowEnvelope {
        source_id: SourceId::new("tcp:one").unwrap(),
        connection_epoch: 3,
        first_sequence: 7,
        last_sequence: 7,
        observed_time_unix_ns: 42,
        direction: Direction::Receive,
        gap_before: None,
        payload: BytesChunk::complete(Bytes::from_static(&[1, 2]), Framing::Stream),
    };
    let value = serde_json::to_value(envelope).unwrap();
    assert_eq!(value["sourceId"], "tcp:one");
    assert_eq!(value["payload"]["bytes"], serde_json::json!([1, 2]));
    assert!(value.get("payloadKind").is_none());
}

#[test]
fn gap_does_not_invent_lost_units() {
    let gap = FlowGap {
        first_missing_sequence: 8,
        last_missing_sequence: 10,
        lost_units: None,
        unit: LostUnit::Unknown,
    };
    assert_eq!(gap.missing_sequences(), 3);
}
