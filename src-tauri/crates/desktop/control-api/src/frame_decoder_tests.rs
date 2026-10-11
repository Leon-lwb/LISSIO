use super::*;
use kind::{DecoderBlockDef, FieldType};

/// 最小帧: Header("AA") + Field(uint8, "value") → 帧 [0xAA, 0x2A] 输出 value=42
fn blocks() -> Vec<DecoderBlockDef> {
    vec![
        DecoderBlockDef::Header {
            id: "h".into(),
            hex: "AA".into(),
            match_id: None,
        },
        DecoderBlockDef::Field {
            id: "f".into(),
            field_type: FieldType::UInt8,
            port_name: "value".into(),
            length_ref: None,
            match_id: None,
        },
    ]
}

#[test]
fn hex_input_parses_outputs_and_consumed_bytes() {
    let r = parse_frame_decoder_input(
        blocks(),
        "AA 2A".into(),
        InputFormat::Hex,
        true,
        false,
        false,
        false,
    );
    assert_eq!(r.error, None);
    assert_eq!(r.consumed_bytes, 2, "帧头 1 + 字段 1");
    assert_eq!(r.outputs.get("value"), Some(&42.0));
    assert!(r.valid, "无校验块 → 校验视为通过");
}

#[test]
fn auto_format_detects_hex_and_parses() {
    let r = parse_frame_decoder_input(
        blocks(),
        "AA 2A".into(),
        InputFormat::Auto,
        true,
        false,
        false,
        false,
    );
    assert_eq!(r.error, None, "偶数长度十六进制应自动判定为 Hex");
    assert_eq!(r.outputs.get("value"), Some(&42.0));
}

#[test]
fn header_not_found_reports_parse_error() {
    let r = parse_frame_decoder_input(
        blocks(),
        "BB 2A".into(),
        InputFormat::Hex,
        true,
        false,
        false,
        false,
    );
    assert_eq!(r.outputs.len(), 0);
    assert_eq!(r.consumed_bytes, 0);
    assert!(!r.valid);
    assert!(
        r.error.unwrap_or_default().contains("无法解析"),
        "帧头找不到应报无法解析"
    );
}

#[test]
fn incomplete_frame_reports_parse_error() {
    // 只有帧头没有字段数据 → 帧不完整
    let r = parse_frame_decoder_input(
        blocks(),
        "AA".into(),
        InputFormat::Hex,
        true,
        false,
        false,
        false,
    );
    assert!(
        r.error.unwrap_or_default().contains("无法解析"),
        "帧不完整应报无法解析"
    );
}

#[test]
fn invalid_hex_reports_decode_error() {
    let r = parse_frame_decoder_input(
        blocks(),
        "ZZ".into(),
        InputFormat::Hex,
        true,
        false,
        false,
        false,
    );
    assert!(r.error.is_some(), "hex 解析失败应返回 error 描述");
    assert_eq!(r.consumed_bytes, 0);
}

/// wire 形状必须是 camelCase — 前端读 `consumedBytes` (回归护栏)。
#[test]
fn wire_shape_is_camel_case() {
    let r = parse_frame_decoder_input(
        blocks(),
        "AA 2A".into(),
        InputFormat::Hex,
        true,
        false,
        false,
        false,
    );
    let value = serde_json::to_value(&r).expect("结果应可序列化");
    assert_eq!(value["consumedBytes"], serde_json::json!(2));
    assert!(
        value.get("consumed_bytes").is_none(),
        "不得回落到 snake_case — 前端读不到该字段"
    );
}
