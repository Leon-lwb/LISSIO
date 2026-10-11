use super::*;
use flow::{Direction, FlowEnvelope, SourceId};
use points::{DeliveryClass, PointBatch, PointId, PointKey, PointQuality, PointValue, Validity};

fn envelope(epoch: u64, values: &[(&str, f64, Validity)]) -> PointEnvelope {
    FlowEnvelope {
        source_id: SourceId::new("device").unwrap(),
        connection_epoch: epoch,
        first_sequence: 0,
        last_sequence: 0,
        observed_time_unix_ns: 0,
        direction: Direction::Receive,
        gap_before: None,
        payload: PointBatch {
            delivery: DeliveryClass::State,
            samples: values
                .iter()
                .map(|(id, value, validity)| PointSample {
                    key: PointKey {
                        source_id: SourceId::new("device").unwrap(),
                        point_id: PointId((*id).into()),
                    },
                    value: Some(PointValue::F64(*value)),
                    quality: PointQuality {
                        validity: *validity,
                        flags: 0,
                        native: None,
                    },
                    source_time_unix_ns: None,
                    server_time_unix_ns: None,
                    received_time_unix_ns: 0,
                })
                .collect(),
        },
    }
}

#[test]
fn partial_batches_retain_only_same_generation_values() {
    let mut latest = LatestPoints::new();
    merge_latest(
        &mut latest,
        "device",
        &envelope(1, &[("a", 1.0, Validity::Good)]),
    );
    merge_latest(
        &mut latest,
        "device",
        &envelope(1, &[("b", 2.0, Validity::Good)]),
    );
    assert_eq!(
        project(&["a".into(), "b".into()], &latest["device"].1),
        vec![1.0, 2.0]
    );

    merge_latest(
        &mut latest,
        "device",
        &envelope(2, &[("b", 3.0, Validity::Bad)]),
    );
    let reset = project(&["a".into(), "b".into()], &latest["device"].1);
    assert!(
        reset[0].is_nan(),
        "old connection values must not leak after reconnect"
    );
    assert!(reset[1].is_nan(), "bad quality must remain visibly invalid");
}
