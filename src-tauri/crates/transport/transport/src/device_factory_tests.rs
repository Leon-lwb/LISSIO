use super::*;

/// 防漂移桥接: schema 枚举必须等于 `CanBitrate::ALL` 的序列化结果,
/// 且每个候选都能被 `CanBitrate` 反序列化接受 (曾因手写 `Bps1M` 大小写漂移)。
#[test]
fn can_bitrate_schema_enum_matches_rust_variants() {
    let expected: Vec<Value> = CanBitrate::ALL
        .iter()
        .map(|bitrate| serde_json::to_value(bitrate).unwrap())
        .collect();
    let field = field_schema("can_bitrate", &json!("Bps500k"));
    assert_eq!(field["enum"], json!(expected));
    for candidate in field["enum"].as_array().unwrap() {
        serde_json::from_value::<CanBitrate>(candidate.clone()).unwrap();
    }
}

/// 修复前 schema 里的非法字面量: 不允许重新出现在候选列表;
/// 反序列化兜底仍接受旧值, 保证旧工作区可加载。
#[test]
fn can_bitrate_schema_enum_rejects_mistyped_names() {
    let field = field_schema("can_bitrate", &json!("Bps500k"));
    for candidate in field["enum"].as_array().unwrap() {
        assert_ne!(candidate, &json!("Bps1M"));
    }
    assert!(serde_json::from_value::<CanBitrate>(json!("Bps1M")).is_err());
    assert!(serde_json::from_value::<CanBitrate>(json!("Bps10k")).is_ok());
}

/// 数值/字符串默认值决定字段类型, 枚举字段不带类型约束之外的信息。
#[test]
fn field_schema_defaults_from_value_shape() {
    let numeric = field_schema("baud_rate", &json!(115200));
    assert_eq!(numeric["type"], "integer");
    assert_eq!(numeric["minimum"], 1);
    assert!(numeric.get("enum").is_none());

    let textual = field_schema("port_name", &json!(""));
    assert_eq!(textual["type"], "string");
    assert_eq!(textual["default"], "");
    assert!(textual.get("enum").is_none());
}
