use super::*;

#[test]
fn wide_integers_serialize_as_strings() {
    assert_eq!(
        serde_json::to_value(PointValue::U64(u64::MAX)).unwrap(),
        serde_json::json!({"kind": "u64", "value": "18446744073709551615"})
    );
}

#[test]
fn bad_quality_never_requires_a_fake_value() {
    let sample = PointSample {
        key: PointKey {
            source_id: flow::SourceId::new("plc").unwrap(),
            point_id: PointId("temperature".into()),
        },
        value: None,
        quality: PointQuality::bad(
            quality_flags::COMM_FAILURE,
            NativeStatus {
                domain: "modbus".into(),
                code: "gatewayTargetFailed".into(),
                detail: None,
            },
        ),
        source_time_unix_ns: None,
        server_time_unix_ns: None,
        received_time_unix_ns: 1,
    };
    assert!(sample.value.is_none());
    assert_eq!(sample.quality.validity, Validity::Bad);
}
