use super::*;

fn empty_inputs() -> HashMap<String, f64> {
    HashMap::new()
}

#[test]
fn const_hex_basic() {
    let frame = CommandFrameDto {
        blocks: vec![BlockDto::ConstHex {
            hex: Some("AA 01 02".into()),
        }],
        append_newline: false,
    };
    let out = compute_frame_bytes(&frame, &empty_inputs());
    assert!(out.error.is_none(), "{}", out.error.unwrap_or_default());
    assert_eq!(out.bytes.unwrap(), vec![0xaa, 0x01, 0x02]);
}

#[test]
fn var_ref_uint16le_default_zero() {
    let frame = CommandFrameDto {
        blocks: vec![BlockDto::VarRef {
            port_name: Some("speed".into()),
            field_type: Some(FieldType::UInt16LE),
        }],
        append_newline: false,
    };
    let out = compute_frame_bytes(&frame, &empty_inputs());
    assert_eq!(out.bytes.unwrap(), vec![0x00, 0x00]);
}

#[test]
fn typed_const_pack() {
    let frame = CommandFrameDto {
        blocks: vec![BlockDto::TypedConst {
            field_type: Some(FieldType::UInt8),
            value: Some("0x42".into()),
        }],
        append_newline: false,
    };
    let out = compute_frame_bytes(&frame, &empty_inputs());
    assert_eq!(out.bytes.unwrap(), vec![0x42]);
}

#[test]
fn checksum_sum8_over_preceding() {
    let frame = CommandFrameDto {
        blocks: vec![
            BlockDto::ConstHex {
                hex: Some("01 02".into()),
            },
            BlockDto::Checksum {
                checksum: Some(ChecksumKind::Sum8),
                custom_script: None,
            },
        ],
        append_newline: false,
    };
    let out = compute_frame_bytes(&frame, &empty_inputs());
    assert_eq!(out.bytes.unwrap(), vec![0x01, 0x02, 0x03]);
}

#[test]
fn append_newline_after_chunks() {
    let frame = CommandFrameDto {
        blocks: vec![BlockDto::ConstHex {
            hex: Some("AA".into()),
        }],
        append_newline: true,
    };
    let out = compute_frame_bytes(&frame, &empty_inputs());
    assert_eq!(out.bytes.unwrap(), vec![0xaa, 0x0a]);
}

#[test]
fn invalid_hex_reports_error_with_block_index() {
    let frame = CommandFrameDto {
        blocks: vec![
            BlockDto::ConstHex {
                hex: Some("AA".into()),
            },
            BlockDto::ConstHex {
                hex: Some("BADHEX1".into()),
            },
        ],
        append_newline: false,
    };
    let out = compute_frame_bytes(&frame, &empty_inputs());
    assert!(out.bytes.is_none());
    let err = out.error.unwrap();
    assert!(err.contains("块 #1"), "missing block index: {err}");
}

/// IPC 契约: 前端发送的 JSON 形状 (camelCase 字段 + `uint16LE` 拼写)
/// 必须原样反序列化 — 任何漂移都会造成预览/自动/手动三路字节不一致。
#[test]
fn frontend_wire_shape_deserializes() {
    let json = serde_json::json!({
        "blocks": [
            { "type": "const_hex", "hex": "AA 55" },
            { "type": "var_ref", "portName": "in1", "fieldType": "float32LE" },
            { "type": "typed_const", "fieldType": "uint8", "value": "0x2a" },
            { "type": "checksum", "checksum": "crc16Modbus" },
            { "type": "checksum", "checksum": "crc16CCITT" }
        ],
        "appendNewline": true
    });
    let frame: CommandFrameDto = serde_json::from_value(json).expect("wire shape must parse");
    assert!(
        frame.append_newline,
        "appendNewline must map to append_newline"
    );
    let inputs = HashMap::from([("in1".to_string(), 1.0_f64)]);
    let out = compute_frame_bytes(&frame, &inputs);
    assert!(out.error.is_none(), "{}", out.error.unwrap_or_default());
    let bytes = out.bytes.unwrap();
    // AA 55 + float32LE(1.0) + [0x2a] + crc16 modbus(2B) + crc16 ccitt(2B) + \n
    assert_eq!(bytes.len(), 2 + 4 + 1 + 2 + 2 + 1);
    assert_eq!(&bytes[2..6], &[0x00, 0x00, 0x80, 0x3f], "float32LE 1.0");
    assert_eq!(bytes[6], 0x2a);
    assert_eq!(*bytes.last().unwrap(), 0x0a);
}
