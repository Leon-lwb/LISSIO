use super::*;
use flow::{Direction, FlowEnvelope, SourceId};
use points::{DeliveryClass, PointBatch, PointQuality, PointSample};

fn sample(id: &str, value: &str) -> PointSample {
    PointSample {
        key: PointKey {
            source_id: SourceId::new("s").unwrap(),
            point_id: points::PointId(id.into()),
        },
        value: Some(PointValue::String(value.into())),
        quality: PointQuality::GOOD,
        source_time_unix_ns: None,
        server_time_unix_ns: None,
        received_time_unix_ns: 0,
    }
}

fn event(sequence: u64) -> FlowEnvelope<PointBatch> {
    FlowEnvelope {
        source_id: SourceId::new("s").unwrap(),
        connection_epoch: 1,
        first_sequence: sequence,
        last_sequence: sequence,
        observed_time_unix_ns: 0,
        direction: Direction::Receive,
        gap_before: None,
        payload: PointBatch {
            delivery: DeliveryClass::Event,
            samples: vec![sample("p", "v")],
        },
    }
}

#[test]
fn state_lane_coalesces_by_key() {
    let lane = StateLane::new(2, 1024);
    lane.push(sample("p", "old")).unwrap();
    lane.push(sample("p", "new")).unwrap();
    assert_eq!(
        lane.snapshot()[0].value,
        Some(PointValue::String("new".into()))
    );
    assert_eq!(lane.stats().overwritten, 1);
}

#[tokio::test]
async fn event_lane_reports_precise_sequence_gap() {
    let (tx, mut rx) = EventLane::channel(1);
    tx.try_send(event(1)).unwrap();
    assert_eq!(tx.try_send(event(2)), Err(LaneError::Full));
    assert!(rx.recv().await.is_some());
    tx.try_send(event(3)).unwrap();
    let next = rx.recv().await.unwrap();
    assert_eq!(next.gap_before.unwrap().first_missing_sequence, 2);
}

#[test]
fn command_lane_is_bounded() {
    let lane = CommandLane::new(1);
    lane.try_send(1).unwrap();
    assert_eq!(lane.try_send(2), Err(LaneError::Full));
}
