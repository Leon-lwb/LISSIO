use super::*;

#[test]
fn configuration_schema_keeps_acquisition_json_spelling() {
    let schema = ConfigurationSchema {
        schema_version: 1,
        json_schema: serde_json::json!({"type": "object"}),
        ui_hints: serde_json::json!({}),
    };
    let wire = serde_json::to_value(&schema).unwrap();
    assert_eq!(
        wire,
        serde_json::json!({
            "schemaVersion": 1,
            "jsonSchema": {"type": "object"},
            "uiHints": {},
        })
    );
}

#[test]
fn port_domain_wire_spelling_matches_graph_derived_history() {
    assert_eq!(
        serde_json::to_value(NodePortDomain::F32).unwrap(),
        serde_json::json!("F32")
    );
    assert_eq!(
        serde_json::to_value(NodePortDomain::Spectrum).unwrap(),
        serde_json::json!("Spectrum")
    );
    assert_eq!(
        serde_json::to_value(NodePortDomain::Points).unwrap(),
        serde_json::json!("Points")
    );
}

#[test]
fn descriptor_wire_uses_camel_case_and_skips_empty_collections() {
    let descriptor = ModelDescriptor {
        id: "widget:Math".into(),
        family: ModelFamily::Widget,
        schema_version: 1,
        display: ModelDisplay::fallback("Math"),
        ui: ModelUiHints::default(),
        configuration: ConfigurationSchema::open(1),
        default_config: Value::Null,
        variants: Vec::new(),
        actions: vec![ModelAction::CreateNode],
        availability: ModelAvailability::unavailable("feature disabled"),
    };
    let wire = serde_json::to_value(&descriptor).unwrap();
    let obj = wire.as_object().unwrap();
    assert_eq!(obj["id"], "widget:Math");
    assert_eq!(obj["family"], "widget");
    assert_eq!(obj["schemaVersion"], 1);
    assert_eq!(obj["display"]["fallbackLabel"], "Math");
    assert_eq!(obj["actions"], serde_json::json!(["createNode"]));
    assert_eq!(obj["availability"]["state"], "unavailable");
    assert_eq!(obj["availability"]["reason"], "feature disabled");
    assert!(!obj.contains_key("variants"));
    assert!(!obj.contains_key("defaultConfig"));
}
