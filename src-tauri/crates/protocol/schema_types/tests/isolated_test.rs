use schema_types::ProtocolConfig;
#[test]
fn unit_variant_from_tag_only() {
    let v = serde_json::json!({ "kind": "Slcan" });
    let config: Result<ProtocolConfig, _> = serde_json::from_value(v);
    assert!(config.is_ok(), "{config:?}");
}
