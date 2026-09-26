mod support;

use device_tree::{
    ChildLimit, ChildPolicy, ConfigError, DeviceTreeDocument, NodeDecl, NodeId, NodePath, NodeRole,
};
use serde_json::json;
use support::{document, node};

#[test]
fn node_identity_survives_rename_but_path_follows_topology() {
    let mut root = node("root", "line0", "root");
    root.children.push(node("serial", "serial0", "serial"));
    let mut tree = document(root);
    let before = tree.paths().expect("valid paths");
    assert_eq!(
        before[&NodeId::new("serial").expect("valid id")].as_str(),
        "/line0/serial0"
    );

    tree.root.name = "plant".into();
    tree.root.children[0].name = "primary".into();
    let after = tree.paths().expect("valid paths");
    assert_eq!(
        after[&NodeId::new("serial").expect("valid id")].as_str(),
        "/plant/primary"
    );
}

#[test]
fn document_round_trip_uses_stable_wire_shape() {
    let mut root = node("root", "root", "root");
    root.children.push(node("endpoint", "plc0", "endpoint"));
    let original = document(root);
    let value = serde_json::to_value(&original).expect("serialize");
    assert_eq!(value["schemaVersion"], json!(1));
    assert_eq!(value["root"]["children"][0]["schemaVersion"], json!(1));
    let decoded: DeviceTreeDocument = serde_json::from_value(value).expect("deserialize");
    assert_eq!(decoded, original);
    assert_eq!(
        original.paths().expect("paths")[&NodeId::new("endpoint").expect("valid id")].to_string(),
        "/root/plc0"
    );
}

#[test]
fn duplicate_sibling_names_and_node_ids_are_rejected() {
    let mut root = node("root", "root", "root");
    root.children.push(node("a", "same", "endpoint"));
    root.children.push(node("b", "same", "endpoint"));
    assert!(matches!(
        document(root).paths().unwrap_err(),
        ConfigError::DuplicateSiblingName { .. }
    ));

    let mut root = node("root", "root", "root");
    root.children.push(node("same", "one", "endpoint"));
    root.children.push(node("same", "two", "endpoint"));
    assert!(matches!(
        document(root).paths().unwrap_err(),
        ConfigError::DuplicateNodeId { .. }
    ));
}

#[test]
fn child_policy_enforces_roles_counts_and_required_roles() {
    let mut policy = ChildPolicy::unlimited([NodeRole::Endpoint, NodeRole::Protocol]);
    policy.allowed.insert(
        NodeRole::Endpoint,
        ChildLimit {
            minimum: 1,
            maximum: Some(1),
        },
    );
    let roles = [
        (NodeId::new("endpoint").expect("id"), NodeRole::Endpoint),
        (NodeId::new("protocol").expect("id"), NodeRole::Protocol),
    ]
    .into_iter()
    .collect();
    let children = vec![
        node("endpoint", "plc0", "endpoint"),
        node("protocol", "modbus0", "protocol"),
    ];
    let root_id = NodeId::new("root").expect("id");
    policy
        .validate(&root_id, &children, &roles)
        .expect("valid policy");
    assert!(policy.is_required(NodeRole::Endpoint));
    assert!(!policy.is_required(NodeRole::Protocol));

    policy.allowed.insert(
        NodeRole::Endpoint,
        ChildLimit {
            minimum: 2,
            maximum: Some(2),
        },
    );
    assert!(matches!(
        policy.validate(&root_id, &children, &roles),
        Err(ConfigError::ChildCountOutOfRange { .. })
    ));

    let bus_only = ChildPolicy::unlimited([NodeRole::Bus]);
    assert!(matches!(
        bus_only.validate(&root_id, &children, &roles),
        Err(ConfigError::UnsupportedChildRole { .. })
    ));
}

#[test]
fn path_helpers_reject_names_that_break_addressing() {
    assert!(matches!(
        NodePath::root("bad/name"),
        Err(ConfigError::InvalidNodeName { .. })
    ));
    assert_eq!(
        NodePath::root("line0")
            .expect("root")
            .child("serial0")
            .expect("child")
            .parent()
            .expect("parent")
            .as_str(),
        "/line0"
    );
    let _ = NodeDecl::leaf("id", "", "driver", 1, json!({})).expect_err("empty names are invalid");
}
