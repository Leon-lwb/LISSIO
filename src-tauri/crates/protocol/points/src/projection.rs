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
#[path = "projection_tests.rs"]
mod tests;
