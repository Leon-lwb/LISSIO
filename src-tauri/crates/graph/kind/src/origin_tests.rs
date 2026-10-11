use super::*;

fn node_id(value: &str) -> NodeId {
    NodeId::new(value).expect("test node id is valid")
}

fn path(value: &str) -> NodePath {
    NodePath::root(value).expect("test path is valid")
}

#[test]
fn default_is_canvas() {
    assert_eq!(NodeOrigin::default(), NodeOrigin::Canvas);
    assert!(NodeOrigin::default().is_canvas());
}

#[test]
fn canvas_wire_is_tagged_unit_variant() {
    let wire = serde_json::to_value(NodeOrigin::Canvas).expect("canvas serializes");
    assert_eq!(wire, serde_json::json!({ "kind": "canvas" }));
    let back: NodeOrigin = serde_json::from_value(wire).expect("canvas deserializes");
    assert_eq!(back, NodeOrigin::Canvas);
}

#[test]
fn derived_wire_uses_camel_case_tag() {
    let origin = NodeOrigin::Derived {
        from: "proto-1".to_string(),
    };
    let wire = serde_json::to_value(&origin).expect("derived serializes");
    assert_eq!(
        wire,
        serde_json::json!({ "kind": "derived", "from": "proto-1" })
    );
    let back: NodeOrigin = serde_json::from_value(wire).expect("derived deserializes");
    assert_eq!(back, origin);
}

#[test]
fn device_tree_wire_renames_node_id_and_skips_empty_fields() {
    let origin = NodeOrigin::DeviceTree {
        node_id: node_id("plc1"),
        path: path("line0"),
        role: Some(NodeRole::Protocol),
        root: node_id("serial0"),
        parent: None,
    };
    let wire = serde_json::to_value(&origin).expect("device tree origin serializes");
    assert_eq!(
        wire,
        serde_json::json!({
            "kind": "deviceTree",
            "nodeId": "plc1",
            "path": "/line0",
            "role": "protocol",
            "root": "serial0",
        })
    );
    let back: NodeOrigin = serde_json::from_value(wire).expect("device tree origin deserializes");
    assert_eq!(back, origin);
}

#[test]
fn device_tree_without_role_round_trips() {
    let origin = NodeOrigin::DeviceTree {
        node_id: node_id("serial0"),
        path: path("serial0"),
        role: None,
        root: node_id("serial0"),
        parent: Some(node_id("line0")),
    };
    let wire = serde_json::to_value(&origin).expect("origin serializes");
    assert!(wire.get("role").is_none());
    assert_eq!(wire.get("parent"), Some(&serde_json::json!("line0")));
    let back: NodeOrigin = serde_json::from_value(wire).expect("origin deserializes");
    assert_eq!(back, origin);
}

#[test]
fn root_device_node_only_answers_for_device_tree_origins() {
    let origin = NodeOrigin::DeviceTree {
        node_id: node_id("plc1"),
        path: path("line0"),
        role: None,
        root: node_id("serial0"),
        parent: None,
    };
    assert_eq!(
        origin.root_device_node().map(NodeId::as_str),
        Some("serial0")
    );
    assert!(NodeOrigin::Canvas.root_device_node().is_none());
    assert!(
        NodeOrigin::Derived {
            from: "proto-1".to_string()
        }
        .root_device_node()
        .is_none()
    );
}
