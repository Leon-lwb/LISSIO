use super::*;
use crate::args::empty_args;
use kind::{DecoderBlockDef, FieldType};
use serde_json::json;

fn blocks() -> serde_json::Value {
    serde_json::to_value(vec![
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
    ])
    .expect("blocks 应可序列化")
}

fn args() -> serde_json::Value {
    json!({
        "blocks": blocks(),
        "input": "AA 2A",
        "format": "hex",
        "enableValid": true,
        "enableFrameCount": false,
        "enableLastTimestamp": false,
        "enableFps": false,
    })
}

/// camelCase 参数经归一后应解析出输出值 (与 IPC 路径同一实现)。
#[test]
fn camel_case_args_parse_frame() {
    let normalized = crate::normalize_args(args());
    let result = parse_frame_decoder_input("parse_frame_decoder_input", &normalized)
        .expect("解析命令不应报错");
    assert_eq!(result["consumedBytes"], json!(2));
    assert_eq!(result["outputs"]["value"], json!(42.0));
    assert_eq!(result["valid"], json!(true));
}

/// 缺失参数是契约错误 (InvalidArguments), 不是静默默认值。
#[test]
fn missing_field_is_invalid_arguments() {
    let error = parse_frame_decoder_input("parse_frame_decoder_input", &empty_args())
        .expect_err("缺参应报错");
    assert_eq!(error.kind, "InvalidArguments");
    assert!(error.message.contains("blocks"));
}
