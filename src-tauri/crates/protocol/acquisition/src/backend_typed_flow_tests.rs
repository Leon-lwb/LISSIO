use super::*;

#[tokio::test]
async fn typed_broadcast_lag_becomes_a_parser_visible_gap() {
    let (tx, rx) = broadcast::channel(1);
    let mut receiver = FlowReceiver::from_typed(rx);
    let source_id = SourceId::new("source").unwrap();
    for sequence in 0..3 {
        tx.send(FlowEnvelope {
            source_id: source_id.clone(),
            connection_epoch: 1,
            first_sequence: sequence,
            last_sequence: sequence,
            observed_time_unix_ns: 0,
            direction: Direction::Receive,
            gap_before: None,
            payload: BytesChunk::complete(vec![u8::try_from(sequence).unwrap()], Framing::Stream),
        })
        .unwrap();
    }
    let envelope = receiver.recv().await.unwrap();
    let gap = envelope.gap_before.unwrap();
    assert_eq!(gap.first_missing_sequence, 0);
    assert_eq!(gap.last_missing_sequence, 1);
    assert_eq!(gap.lost_units, Some(2));
    assert_eq!(envelope.payload.bytes.as_ref(), &[2]);
}
