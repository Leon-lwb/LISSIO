use super::{ScaleError, apply_scale, as_f64, as_i64, as_u64, unscale};
use crate::PointValue;

#[test]
fn identity_scale_returns_the_value_unchanged() {
    assert_eq!(
        apply_scale(PointValue::I64(-3), 1.0, 0.0).unwrap(),
        PointValue::I64(-3)
    );
    assert_eq!(
        unscale(&PointValue::U64(7), 1.0, 0.0).unwrap(),
        PointValue::U64(7)
    );
}

#[test]
fn scale_and_unscale_round_trip() {
    let scaled = apply_scale(PointValue::I64(10), 2.0, 5.0).unwrap();
    assert_eq!(scaled, PointValue::F64(25.0));
    assert_eq!(unscale(&scaled, 2.0, 5.0).unwrap(), PointValue::F64(10.0));
}

#[test]
fn non_numeric_values_pass_through_apply_scale() {
    let text = PointValue::Bool(true);
    assert_eq!(apply_scale(text.clone(), 2.0, 1.0).unwrap(), text);
}

#[test]
fn invalid_parameters_and_results_are_reported() {
    assert_eq!(
        unscale(&PointValue::F64(1.0), 0.0, 0.0),
        Err(ScaleError::NonFinite)
    );
    assert_eq!(
        apply_scale(PointValue::F64(f64::MAX), 2.0, 0.0),
        Err(ScaleError::NonFinite)
    );
}

#[test]
fn integers_convert_and_other_types_are_type_mismatches() {
    assert_eq!(as_u64(PointValue::F64(3.0)), Ok(3));
    assert_eq!(as_i64(PointValue::F64(-3.0)), Ok(-3));
    assert_eq!(as_f64(PointValue::U64(3)), Ok(3.0));
    assert_eq!(as_u64(PointValue::F64(-1.0)), Err(ScaleError::TypeMismatch));
    assert_eq!(as_i64(PointValue::F64(1.5)), Err(ScaleError::TypeMismatch));
    assert_eq!(
        as_f64(PointValue::Bool(false)),
        Err(ScaleError::TypeMismatch)
    );
}
