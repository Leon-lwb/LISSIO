use super::*;
use crate::{PointId, PointKey, PointQuality};
fn sample(value: PointValue) -> PointSample {
    PointSample {
        key: PointKey {
            source_id: flow::SourceId::new("source").unwrap(),
            point_id: PointId("point".into()),
        },
        value: Some(value),
        quality: PointQuality::GOOD,
        source_time_unix_ns: None,
        server_time_unix_ns: None,
        received_time_unix_ns: 0,
    }
}
#[test]
fn native_values_are_unchanged_and_invalid_values_do_not_become_samples() {
    assert_eq!(numeric(&sample(PointValue::Bool(true))), Some(1.0));
    assert_eq!(numeric(&sample(PointValue::F64(f64::MAX))), None);
    assert_eq!(numeric(&sample(PointValue::F64(f64::NAN))), None);
    let mut raw = sample(PointValue::U64(u64::MAX));
    assert!(numeric(&raw).is_some());
    assert_eq!(raw.value, Some(PointValue::U64(u64::MAX)));
    raw.quality.validity = Validity::Bad;
    assert_eq!(numeric(&raw), None);
}
