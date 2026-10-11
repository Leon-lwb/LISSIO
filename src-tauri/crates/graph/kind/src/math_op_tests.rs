use super::*;

#[test]
fn test_add() {
    assert!((MathOp::Add.evaluate(&[1.0, 2.0, 3.0]) - 6.0).abs() < f32::EPSILON);
}

#[test]
fn test_sub() {
    assert!((MathOp::Sub.evaluate(&[10.0, 3.0, 2.0]) - 5.0).abs() < f32::EPSILON);
}

#[test]
fn test_mul() {
    assert!((MathOp::Mul.evaluate(&[2.0, 3.0, 4.0]) - 24.0).abs() < f32::EPSILON);
}

#[test]
fn test_div_zero_returns_zero() {
    assert_eq!(MathOp::Div.evaluate(&[10.0, 0.0]), 0.0);
}

#[test]
fn test_div_chain() {
    assert!((MathOp::Div.evaluate(&[100.0, 5.0, 2.0]) - 10.0).abs() < f32::EPSILON);
}

#[test]
fn test_avg() {
    assert!((MathOp::Avg.evaluate(&[1.0, 2.0, 3.0]) - 2.0).abs() < f32::EPSILON);
}

#[test]
fn test_min_max() {
    assert_eq!(MathOp::Min.evaluate(&[3.0, 1.0, 2.0]), 1.0);
    assert_eq!(MathOp::Max.evaluate(&[3.0, 1.0, 2.0]), 3.0);
}

#[test]
fn test_unary() {
    assert_eq!(MathOp::Abs.evaluate(&[-5.0]), 5.0);
    assert_eq!(MathOp::Neg.evaluate(&[5.0]), -5.0);
    assert_eq!(MathOp::Square.evaluate(&[3.0]), 9.0);
    assert!((MathOp::Sqrt.evaluate(&[9.0]) - 3.0).abs() < f32::EPSILON);
    assert_eq!(MathOp::Sqrt.evaluate(&[-1.0]), 0.0);
}

#[test]
fn test_trig() {
    assert!((MathOp::Sin.evaluate(&[0.0])).abs() < f32::EPSILON);
    assert!((MathOp::Cos.evaluate(&[0.0]) - 1.0).abs() < f32::EPSILON);
}

#[test]
fn test_log() {
    assert!((MathOp::Log.evaluate(&[1.0])).abs() < f32::EPSILON);
    assert_eq!(MathOp::Log.evaluate(&[-1.0]), 0.0);
    assert_eq!(MathOp::Log.evaluate(&[0.0]), 0.0);
}

#[test]
fn test_empty_inputs() {
    assert_eq!(MathOp::Add.evaluate(&[]), 0.0);
}

#[test]
fn test_nan_filtered() {
    assert_eq!(MathOp::Add.evaluate(&[1.0, f32::NAN, 2.0]), 3.0);
}
