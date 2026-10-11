use super::*;

/// 与前端 justfloatSchema(2) 的输出逐字一致
#[test]
fn justfloat_matches_frontend_output() {
    let schema = justfloat_schema(Some(2));
    let wire = serde_json::to_value(&schema).unwrap();
    assert_eq!(
        wire,
        serde_json::json!({
            "preset": "justFloat",
            "presetConfig": { "kind": "JustFloat", "channels": 2 },
            "decode": [
                { "id": "jf-f0", "type": "field", "fieldType": "float32LE", "portName": "ch0" },
                { "id": "jf-f1", "type": "field", "fieldType": "float32LE", "portName": "ch1" },
                { "id": "jf-tail", "type": "tail", "hex": "00 00 80 7F" },
            ],
        })
    );
}

#[test]
fn firewater_matches_frontend_output() {
    let schema = firewater_schema(None);
    let wire = serde_json::to_value(&schema).unwrap();
    assert_eq!(
        wire["decode"][0],
        serde_json::json!({ "type": "csv", "separator": ",", "ports": ["ch0", "ch1", "ch2", "ch3"] })
    );
    assert_eq!(
        wire["presetConfig"],
        serde_json::json!({ "kind": "FireWater", "channels": null })
    );
}

#[test]
fn raw_data_has_no_decode_blocks() {
    let schema = raw_data_schema();
    assert!(schema.decode.is_empty());
    assert_eq!(schema.preset, SchemaPreset::RawData);
}

#[test]
fn logic_decode_wraps_decoder_config() {
    let decoder = logic::LogicDecoderConfig::I2c {
        sda_channel: 0,
        scl_channel: 1,
    };
    let schema = logic_decode_schema(decoder);
    assert_eq!(schema.decode.len(), 1);
    assert!(matches!(schema.decode[0], DecoderBlockDef::Samples { .. }));
}

#[test]
fn port_names_follow_preset_rules() {
    // RawData → 单 str 字符串口
    assert_eq!(
        protocol_port_names(None, &ProtocolConfig::RawData, 0),
        vec!["str"]
    );
    // JustFloat 手动 2 通道
    assert_eq!(
        protocol_port_names(None, &ProtocolConfig::JustFloat { channels: Some(2) }, 0),
        vec!["ch0", "ch1"]
    );
    // 自动检测值优先于占位默认
    assert_eq!(
        protocol_port_names(None, &ProtocolConfig::JustFloat { channels: None }, 6).len(),
        6
    );
}

#[test]
fn effective_channels_prefers_manual_then_detected() {
    assert_eq!(
        effective_channels(&ProtocolConfig::JustFloat { channels: Some(8) }, None),
        8
    );
    assert_eq!(
        effective_channels(&ProtocolConfig::JustFloat { channels: None }, Some(6)),
        6
    );
    assert_eq!(
        effective_channels(&ProtocolConfig::RawData, None),
        DEFAULT_PRESET_CHANNELS
    );
}

#[test]
fn diagnostic_uses_neutral_custom_schema() {
    let config = ProtocolConfig::Diagnostic {
        config: serde_json::from_value(serde_json::json!({
            "kind": "J1939", "j1939": { "source_address": 0, "heartbeat_interval_ms": 1000 }
        }))
        .unwrap(),
    };
    let schema = schema_from_protocol_config(&config);
    assert_eq!(schema.preset, SchemaPreset::Custom);
    assert!(schema.decode.is_empty());
}

#[test]
fn justfloat_tail_bytes_match_hex() {
    let hex: Vec<u8> = crate::preset::JUSTFLOAT_TAIL_HEX
        .split_whitespace()
        .map(|byte| u8::from_str_radix(byte, 16).unwrap())
        .collect();
    assert_eq!(hex, crate::preset::JUSTFLOAT_TAIL);
}
