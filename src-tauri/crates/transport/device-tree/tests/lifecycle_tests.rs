mod support;

use device_tree::{
    Capability, CapabilityMask, ChildPolicy, DeviceTree, DriverRegistry, NodeRole, NodeState,
};
use std::sync::Arc;
use support::{TestDriver, document, node};

#[tokio::test]
async fn opens_parent_before_children_and_closes_children_before_parent() {
    let registry = Arc::new(DriverRegistry::new());
    let parent_driver = Arc::new(
        TestDriver::new("bus", NodeRole::Bus)
            .child_policy(ChildPolicy::unlimited([NodeRole::Protocol]))
            .capabilities(CapabilityMask::only(Capability::ByteSource)),
    );
    let child_driver = Arc::new(
        TestDriver::new("protocol", NodeRole::Protocol)
            .child_policy(ChildPolicy::unlimited([NodeRole::Endpoint])),
    );
    let leaf_driver = Arc::new(TestDriver::new("endpoint", NodeRole::Endpoint));
    let parent_log = parent_driver.log_handle();
    let child_log = child_driver.log_handle();
    let leaf_log = leaf_driver.log_handle();
    registry.register(parent_driver).expect("register parent");
    registry.register(child_driver).expect("register child");
    registry.register(leaf_driver).expect("register leaf");

    let mut parent = node("bus", "serial0", "bus");
    let mut protocol = node("protocol", "modbus0", "protocol");
    protocol.children.push(node("leaf", "plc0", "endpoint"));
    parent.children.push(protocol);
    let mut root = node("root", "root", "root");
    root.children.push(parent);
    let tree = DeviceTree::new(registry)
        .open(document(root))
        .await
        .expect("open tree");

    assert_eq!(parent_log.lock().expect("log")[0], "open:bus");
    assert_eq!(child_log.lock().expect("log")[0], "open:protocol");
    assert_eq!(leaf_log.lock().expect("log")[0], "open:leaf");

    let mut states = tree.subscribe_states();
    tree.close().await.expect("close tree");
    let mut events = Vec::new();
    while let Ok(event) = states.try_recv() {
        events.push(event);
    }
    let closing_order: Vec<_> = events
        .iter()
        .filter(|event| matches!(event.state, NodeState::Closing))
        .map(|event| event.node_id.as_str())
        .collect();
    let close_positions = [
        closing_order
            .iter()
            .position(|id| *id == "leaf")
            .expect("leaf close"),
        closing_order
            .iter()
            .position(|id| *id == "protocol")
            .expect("protocol close"),
        closing_order
            .iter()
            .position(|id| *id == "bus")
            .expect("bus close"),
    ];
    assert!(close_positions[0] < close_positions[1]);
    assert!(close_positions[1] < close_positions[2]);

    tree.close().await.expect("second close is idempotent");
    assert_eq!(
        support::operation_counts(&parent_log.lock().expect("log").clone())["close:bus"],
        1
    );
}

#[tokio::test]
async fn disabled_node_is_preserved_but_never_opened() {
    let registry = Arc::new(DriverRegistry::new());
    let driver = Arc::new(TestDriver::new("endpoint", NodeRole::Endpoint));
    let log = driver.log_handle();
    registry.register(driver).expect("register");
    let mut child = node("child", "plc0", "endpoint");
    child.enabled = false;
    let mut root = node("root", "root", "root");
    root.children.push(child);

    let tree = DeviceTree::new(registry)
        .open(document(root))
        .await
        .expect("open");
    let snapshots = tree.snapshots();
    assert!(matches!(snapshots[1].state, NodeState::Disabled));
    assert!(log.lock().expect("log").is_empty());
    tree.close().await.expect("close");
}

#[tokio::test]
async fn optional_child_failure_keeps_parent_online_and_sibling_open() {
    let registry = Arc::new(DriverRegistry::new());
    let parent_driver = Arc::new(
        TestDriver::new("bus", NodeRole::Bus)
            .capabilities(CapabilityMask::only(Capability::ByteSource))
            .child_policy(ChildPolicy::unlimited([NodeRole::Endpoint])),
    );
    let failing_driver =
        Arc::new(TestDriver::new("failing", NodeRole::Endpoint).fail_nodes(&["failed"]));
    let healthy_driver = Arc::new(TestDriver::new("healthy", NodeRole::Endpoint));
    registry.register(parent_driver).expect("register parent");
    registry.register(failing_driver).expect("register failing");
    registry.register(healthy_driver).expect("register healthy");

    let mut bus = node("bus", "tcp0", "bus");
    bus.children.push(node("failed", "bad", "failing"));
    bus.children.push(node("healthy", "good", "healthy"));
    let mut root = node("root", "root", "root");
    root.children.push(bus);

    let tree = DeviceTree::new(registry)
        .open(document(root))
        .await
        .expect("open");
    let snapshots = tree.snapshots();
    assert!(matches!(snapshots[1].state, NodeState::Online { .. }));
    assert!(matches!(snapshots[2].state, NodeState::Degraded { .. }));
    assert!(matches!(snapshots[3].state, NodeState::Online { .. }));
    tree.close().await.expect("close");
}

#[tokio::test]
async fn required_child_failure_degrades_only_its_parent_subtree() {
    let registry = Arc::new(DriverRegistry::new());
    let required_parent = Arc::new(
        TestDriver::new("required-parent", NodeRole::Bus)
            .child_policy(ChildPolicy::required(NodeRole::Endpoint))
            .capabilities(CapabilityMask::only(Capability::ByteSource)),
    );
    let optional_parent = Arc::new(
        TestDriver::new("optional-parent", NodeRole::Bus)
            .child_policy(ChildPolicy::unlimited([NodeRole::Endpoint]))
            .capabilities(CapabilityMask::only(Capability::ByteSink)),
    );
    let failing = Arc::new(TestDriver::new("failing", NodeRole::Endpoint).fail_nodes(&["bad"]));
    let healthy = Arc::new(TestDriver::new("healthy", NodeRole::Endpoint));
    registry
        .register(required_parent)
        .expect("register required");
    registry
        .register(optional_parent)
        .expect("register optional");
    registry.register(failing).expect("register failing");
    registry.register(healthy).expect("register healthy");

    let mut required = node("required", "required", "required-parent");
    required.children.push(node("bad", "bad", "failing"));
    let mut optional = node("optional", "optional", "optional-parent");
    optional.children.push(node("good", "good", "healthy"));
    let mut root = node("root", "root", "root");
    root.children.push(required);
    root.children.push(optional);

    let tree = DeviceTree::new(registry)
        .open(document(root))
        .await
        .expect("open");
    let snapshots = tree.snapshots();
    assert!(matches!(snapshots[1].state, NodeState::Degraded { .. }));
    assert!(matches!(snapshots[2].state, NodeState::Degraded { .. }));
    assert!(matches!(snapshots[3].state, NodeState::Online { .. }));
    assert!(matches!(snapshots[4].state, NodeState::Online { .. }));
    tree.close().await.expect("close");
}

#[tokio::test]
async fn state_events_carry_identity_path_epoch_and_error_detail() {
    let registry = Arc::new(DriverRegistry::new());
    let driver = Arc::new(TestDriver::new("endpoint", NodeRole::Endpoint));
    registry.register(driver).expect("register");
    let mut root = node("root", "root", "root");
    root.children.push(node("endpoint", "plc0", "endpoint"));
    let tree = DeviceTree::new(registry)
        .open(document(root))
        .await
        .expect("open");
    let mut states = tree.subscribe_states();
    tree.close().await.expect("close");
    let mut events = Vec::new();
    while let Ok(event) = states.try_recv() {
        events.push(event);
    }
    let closing = events
        .iter()
        .find(|event| event.node_id.as_str() == "root" && matches!(event.state, NodeState::Closing))
        .expect("root closing event");
    assert_eq!(closing.node_id.as_str(), "root");
    assert_eq!(closing.node_path.as_str(), "/root");
    assert!(matches!(closing.state, NodeState::Closing));
    let closed = events
        .iter()
        .find(|event| event.node_id.as_str() == "root" && matches!(event.state, NodeState::Closed))
        .expect("root closed event");
    assert_eq!(closed.node_id.as_str(), "root");
    assert_eq!(closed.error_kind, None);
    assert_eq!(closed.detail, None);
}

#[tokio::test]
async fn inactive_subtrees_preserve_descendants_and_paths_without_opening_them() {
    for disabled in [true, false] {
        let registry = Arc::new(DriverRegistry::new());
        let driver = Arc::new(
            TestDriver::new("branch", NodeRole::Bus)
                .child_policy(ChildPolicy::unlimited([NodeRole::Bus]))
                .fail_nodes(&["parent"]),
        );
        let log = driver.log_handle();
        registry.register(driver).unwrap();
        let mut parent = node("parent", "parent", "branch");
        parent.enabled = !disabled;
        let mut child = node("child", "child", "branch");
        child.children.push(node("leaf", "leaf", "branch"));
        parent.children.push(child);
        let mut root = node("root", "root", "root");
        root.children.push(parent);
        let tree = DeviceTree::new(registry)
            .open(document(root))
            .await
            .unwrap();
        let snapshots = tree.snapshots();
        assert_eq!(snapshots.len(), 4);
        for snapshot in &snapshots[1..] {
            assert!(tree.runtime(&snapshot.node_id).is_none());
            assert_eq!(tree.path(&snapshot.node_id), Some(&snapshot.node_path));
            if disabled {
                assert_eq!(snapshot.state, NodeState::Disabled);
            } else {
                assert!(matches!(snapshot.state, NodeState::Degraded { .. }));
            }
        }
        assert_eq!(snapshots[3].node_path.as_str(), "/root/parent/child/leaf");
        assert_eq!(log.lock().unwrap().len(), usize::from(!disabled));
        tree.close().await.unwrap();
    }
}

#[tokio::test]
async fn close_errors_are_reported_only_on_the_node_that_failed() {
    let registry = Arc::new(DriverRegistry::new());
    registry
        .register(Arc::new(TestDriver::new("good", NodeRole::Endpoint)))
        .unwrap();
    registry
        .register(Arc::new(
            TestDriver::new("bad", NodeRole::Endpoint).fail_close(),
        ))
        .unwrap();
    let mut root = node("root", "root", "root");
    root.children.push(node("good", "good", "good"));
    root.children.push(node("bad", "bad", "bad"));
    let tree = DeviceTree::new(registry)
        .open(document(root))
        .await
        .unwrap();
    let mut states = tree.subscribe_states();
    let errors = tree.close().await.unwrap_err();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].node_id.as_str(), "bad");
    while let Ok(event) = states.try_recv() {
        if event.state == NodeState::Closed {
            assert_eq!(event.error_kind.is_some(), event.node_id.as_str() == "bad");
            assert_eq!(event.detail.is_some(), event.node_id.as_str() == "bad");
        }
    }
}
