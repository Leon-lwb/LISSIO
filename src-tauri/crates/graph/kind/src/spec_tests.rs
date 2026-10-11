use super::*;

#[test]
fn new_defaults_to_canvas_origin() {
    let node = NodeDef::new("n1".into(), "tab".into(), NodeKind::Input);
    assert!(node.origin().is_canvas());
    assert_eq!(node.id_str(), "n1");
    assert_eq!(node.tab_id_str(), "tab");
}

#[test]
fn derived_constructor_marks_its_source() {
    let node = NodeDef::derived("proto", "proto".into(), "tab".into(), NodeKind::Input);
    assert_eq!(
        node.origin(),
        &NodeOrigin::Derived {
            from: "proto".to_string()
        }
    );
}

#[test]
fn missing_origin_field_deserializes_as_canvas() {
    let wire = serde_json::json!({
        "id": "n1",
        "tab_id": "tab",
        "kind": { "kind": "Input", "params": null },
    });
    let node: NodeDef = serde_json::from_value(wire).expect("legacy-shaped payload parses");
    assert!(node.origin().is_canvas());
}

#[test]
fn origin_round_trips_through_wire() {
    let node = NodeDef::with_origin(
        "n1".into(),
        "tab".into(),
        NodeKind::Input,
        NodeOrigin::Derived {
            from: "proto".into(),
        },
    );
    let wire = serde_json::to_value(&node).expect("node serializes");
    let back: NodeDef = serde_json::from_value(wire).expect("node deserializes");
    assert_eq!(back.origin, node.origin);
}
