//! Explicit, finite projection at a numeric graph boundary. Native samples remain unchanged.
use crate::{PointSample, PointValue, Validity};

#[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation)]
pub fn numeric(sample: &PointSample) -> Option<f32> {
    if sample.quality.validity != Validity::Good || sample.quality.flags != 0 {
        return None;
    }
    let value = match sample.value.as_ref()? {
        PointValue::Bool(value) => f64::from(u8::from(*value)),
        PointValue::I64(value) => *value as f64,
        PointValue::U64(value) => *value as f64,
        PointValue::F64(value) => *value,
        _ => return None,
    };
    let projected = value as f32;
    projected.is_finite().then_some(projected)
}

#[cfg(test)]
mod tests {
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
}
