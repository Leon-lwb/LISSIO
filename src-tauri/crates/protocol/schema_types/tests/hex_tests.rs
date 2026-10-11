//! HEX 解析集成测试。

use schema_types::hex::{parse_hex, parse_hex_lossy};

#[test]
fn parse_hex_simple_space_separated() {
    assert_eq!(parse_hex("AA BB CC").unwrap(), vec![0xAA, 0xBB, 0xCC]);
}

#[test]
fn parse_hex_no_separator() {
    assert_eq!(parse_hex("AABBCC").unwrap(), vec![0xAA, 0xBB, 0xCC]);
}

#[test]
fn parse_hex_lowercase() {
    assert_eq!(parse_hex("aa bb").unwrap(), vec![0xAA, 0xBB]);
}

#[test]
fn parse_hex_mixed_case() {
    assert_eq!(parse_hex("AaBbCc").unwrap(), vec![0xAA, 0xBB, 0xCC]);
}

#[test]
fn parse_hex_with_0x_prefix() {
    assert_eq!(parse_hex("0xAA 0xBB").unwrap(), vec![0xAA, 0xBB]);
    assert_eq!(parse_hex("0xAA0xBB").unwrap(), vec![0xAA, 0xBB]);
    assert_eq!(parse_hex("0XAA 0XBB").unwrap(), vec![0xAA, 0xBB]);
}

#[test]
fn parse_hex_with_comma_separator() {
    assert_eq!(parse_hex("AA,BB,CC").unwrap(), vec![0xAA, 0xBB, 0xCC]);
}

#[test]
fn parse_hex_mixed_separators() {
    assert_eq!(parse_hex("AA, BB 0xCC").unwrap(), vec![0xAA, 0xBB, 0xCC]);
}

#[test]
fn parse_hex_tabs_and_newlines() {
    assert_eq!(parse_hex("AA\tBB\nCC").unwrap(), vec![0xAA, 0xBB, 0xCC]);
}

#[test]
fn parse_hex_empty_string() {
    assert!(parse_hex("").unwrap().is_empty());
}

#[test]
fn parse_hex_whitespace_only() {
    assert!(parse_hex("   \t\n").unwrap().is_empty());
}

#[test]
fn parse_hex_odd_length_is_an_error() {
    assert!(parse_hex("AAB").is_err());
    assert!(parse_hex("AA BB C").is_err());
    // 宽松变体把非法输入当作空字节序列
    assert!(parse_hex_lossy("AAB").is_empty());
}

#[test]
fn parse_hex_invalid_chars_are_errors() {
    assert!(parse_hex("ZZ").is_err());
    assert!(parse_hex("AA XX").is_err());
    assert!(parse_hex_lossy("ZZ").is_empty());
}

#[test]
fn parse_hex_single_byte() {
    assert_eq!(parse_hex("FF").unwrap(), vec![0xFF]);
    assert_eq!(parse_hex("00").unwrap(), vec![0x00]);
}

#[test]
fn parse_hex_decimal_digit_not_allowed() {
    // "9" 是合法 hex 但单字符奇数 → 报错
    assert!(parse_hex("9").is_err());
    assert_eq!(parse_hex("09").unwrap(), vec![0x09]);
}

#[test]
fn parse_hex_trailing_whitespace_ignored() {
    assert_eq!(parse_hex("AA BB   ").unwrap(), vec![0xAA, 0xBB]);
}
