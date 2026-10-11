use super::*;
use flow::{Direction, FlowEnvelope, SourceId};
use points::{DeliveryClass, PointBatch, PointId, PointQuality, PointValue};

fn envelope(epoch: u64, value: u64) -> PointEnvelope {
    let source = SourceId::new("source").unwrap();
    FlowEnvelope {
        source_id: source.clone(),
        connection_epoch: epoch,
        first_sequence: value,
        last_sequence: value,
        observed_time_unix_ns: 0,
        direction: Direction::Receive,
        gap_before: None,
        payload: PointBatch {
            delivery: DeliveryClass::State,
            samples: vec![PointSample {
                key: PointKey {
                    source_id: source,
                    point_id: PointId("p".into()),
                },
                value: Some(PointValue::U64(value)),
                quality: PointQuality::GOOD,
                source_time_unix_ns: None,
                server_time_unix_ns: None,
                received_time_unix_ns: 0,
            }],
        },
    }
}

#[test]
fn point_store_rejects_old_epoch_callbacks() {
    let mut store = PointStore::new(4);
    store.apply(&envelope(2, 2));
    store.apply(&envelope(1, 1));
    let key = PointKey {
        source_id: SourceId::new("source").unwrap(),
        point_id: PointId("p".into()),
    };
    assert_eq!(store.get(&key).unwrap().value, Some(PointValue::U64(2)));
}
