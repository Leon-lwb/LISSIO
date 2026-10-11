use super::*;

#[test]
fn protocol_values_are_stable_and_renderer_neutral() {
    assert_eq!(
        serde_json::to_value(ProtocolKind::ModbusTcp).unwrap(),
        serde_json::json!("modbus-tcp")
    );
    assert_eq!(
        serde_json::to_value(ProtocolKind::ModbusRtu).unwrap(),
        serde_json::json!("modbus-rtu")
    );
    let serialized = serde_json::to_string(&DisplaySemantics {
        category: Some("industrial-control".into()),
        symbol: Some("registers".into()),
        tags: BTreeSet::new(),
    })
    .unwrap();
    assert!(!serialized.contains("Component"));
    assert!(!serialized.contains("Renderer"));
}
