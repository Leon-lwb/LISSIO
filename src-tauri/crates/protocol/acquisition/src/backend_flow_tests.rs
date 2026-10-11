use super::*;

#[tokio::test]
async fn compatibility_receiver_preserves_boundary_and_reports_message_gap() {
    let (tx, rx) = broadcast::channel(2);
    let mut flow =
        BroadcastFlowReceiver::new(SourceId::new("udp:test").unwrap(), 4, Framing::Datagram, rx);
    tx.send(ByteMessage::from_device(vec![0])).unwrap();
    tx.send(ByteMessage::from_device(vec![1])).unwrap();
    tx.send(ByteMessage::from_device(vec![2])).unwrap();

    let envelope = flow.recv().await.unwrap();
    assert_eq!(envelope.connection_epoch, 4);
    assert_eq!(envelope.first_sequence, 1);
    assert_eq!(envelope.payload.framing, Framing::Datagram);
    let gap = envelope.gap_before.unwrap();
    assert_eq!(
        (gap.first_missing_sequence, gap.last_missing_sequence),
        (0, 0)
    );
    assert_eq!((gap.lost_units, gap.unit), (Some(1), LostUnit::Messages));
}

#[tokio::test]
async fn receiver_maps_message_direction_into_envelope() {
    let (tx, rx) = broadcast::channel(4);
    let mut flow = BroadcastFlowReceiver::new(
        SourceId::new("serial:test").unwrap(),
        1,
        Framing::Stream,
        rx,
    );
    tx.send(ByteMessage::from_device(vec![1])).unwrap();
    tx.send(ByteMessage::loopback(vec![2])).unwrap();

    assert_eq!(flow.recv().await.unwrap().direction, Direction::Receive);
    assert_eq!(flow.recv().await.unwrap().direction, Direction::Transmit);
}
