use super::parse_range;

#[test]
fn parse_range_basic() {
    assert_eq!(parse_range("1..10"), Some((1.0, 10.0)));
    assert_eq!(parse_range("-5.5..3.75"), Some((-5.5, 3.75)));
    assert_eq!(parse_range("-10..0"), Some((-10.0, 0.0)));
}

#[test]
fn parse_range_infinity() {
    assert_eq!(
        parse_range("-Infinity..Infinity"),
        Some((f32::NEG_INFINITY, f32::INFINITY))
    );
    assert_eq!(parse_range("0..Infinity"), Some((0.0, f32::INFINITY)));
    assert_eq!(parse_range("-Infinity..0"), Some((f32::NEG_INFINITY, 0.0)));
}

#[test]
fn parse_range_invalid() {
    assert_eq!(parse_range("10..1"), None); // 反向
    assert_eq!(parse_range("abc..xyz"), None); // 非数字
    assert_eq!(parse_range("1.."), None); // 缺上限
    assert_eq!(parse_range("..10"), None); // 缺下限
    assert_eq!(parse_range(""), None);
    assert_eq!(parse_range("1.2.3..5"), None); // 多点号
}
