mod support;

use device_tree::{
    Capability, CapabilityMask, ChildPolicy, ConfigError, ContractError, DriverContractFixture,
    DriverId, DriverRegistry, NodeDriver, NodeRole,
};
use serde_json::json;
use std::sync::Arc;
use support::{TestDriver, node, port};

#[tokio::test]
async fn matching_runtime_projection_passes_and_close_is_idempotent() {
    let registry = Arc::new(DriverRegistry::new());
    let capabilities = CapabilityMask::only(Capability::ByteSource);
    let driver = Arc::new(TestDriver::new("test", NodeRole::Bus).capabilities(capabilities));
    let log = driver.log_handle();
    registry.register(driver).expect("register driver");

    registry
        .contract_check(
            DriverContractFixture::new("node", DriverId::new("test"), 1, json!({}))
                .expect("fixture"),
        )
        .await
        .expect("contract passes");
    assert_eq!(
        support::operation_counts(&log.lock().expect("log lock").clone())["close:node"],
        2
    );
}

#[tokio::test]
async fn capability_declaration_must_equal_runtime_projection() {
    let registry = Arc::new(DriverRegistry::new());
    let driver = Arc::new(
        TestDriver::new("test", NodeRole::Endpoint).mismatched_capabilities(
            CapabilityMask::only(Capability::Read),
            CapabilityMask::only(Capability::Write),
        ),
    );
    registry.register(driver).expect("register driver");

    let error = registry
        .contract_check(
            DriverContractFixture::new("node", DriverId::new("test"), 1, json!({}))
                .expect("fixture"),
        )
        .await
        .expect_err("projection mismatch");
    assert!(matches!(
        error,
        ContractError::CapabilityMismatch {
            capability: Capability::Read | Capability::Write,
            ..
        }
    ));
}

#[tokio::test]
async fn child_driver_checks_required_parent_capability_and_port() {
    let registry = Arc::new(DriverRegistry::new());
    let parent_driver = Arc::new(
        TestDriver::new("bus", NodeRole::Bus)
            .capabilities(CapabilityMask::only(Capability::ByteSource))
            .ports(vec![port("bytes")]),
    );
    registry
        .register(parent_driver.clone())
        .expect("register parent");

    let child_driver = TestDriver::new("protocol", NodeRole::Protocol)
        .require_parent(&[Capability::ByteSource], &["bytes"]);
    let validated = parent_driver
        .validate(&json!({}), None)
        .expect("validate parent");
    let parent_runtime = parent_driver
        .open(
            validated,
            None,
            device_tree::NodeContext::new(
                device_tree::NodeId::new("parent").expect("id"),
                device_tree::NodePath::root("parent").expect("path"),
                1,
                tokio::sync::broadcast::channel(1).0,
            ),
        )
        .await
        .expect("open parent fixture");
    let fixture_parent = device_tree::parent_fixture(NodeRole::Bus, parent_runtime.clone());
    let child_driver = Arc::new(child_driver);
    registry
        .register(child_driver.clone())
        .expect("register child");
    let fixture = device_tree::DriverContractFixture {
        node_id: device_tree::NodeId::new("child").expect("id"),
        driver_id: DriverId::new("protocol"),
        schema_version: 1,
        config: json!({}),
        parent: Some(fixture_parent),
    };
    registry
        .contract_check(fixture)
        .await
        .expect("parent contract satisfied");
    parent_runtime.close().await.expect("close parent fixture");
}

#[tokio::test]
async fn registry_rejects_duplicate_driver_and_unsupported_child_role() {
    let registry = Arc::new(DriverRegistry::new());
    registry
        .register(Arc::new(TestDriver::new("test", NodeRole::Bus)))
        .expect("register");
    assert!(matches!(
        registry.register(Arc::new(TestDriver::new("test", NodeRole::Bus))),
        Err(ConfigError::DuplicateDriver { .. })
    ));

    registry
        .register(Arc::new(
            TestDriver::new("strict-root", NodeRole::Virtual).child_policy(ChildPolicy::none()),
        ))
        .expect("register strict root");
    let mut root = node("root", "root", "strict-root");
    root.children.push(node("child", "child", "test"));
    let error = registry
        .validate(&device_tree::DeviceTreeDocument::new(root))
        .expect_err("strict root rejects Bus child");
    assert!(matches!(
        error,
        ConfigError::UnsupportedChildRole {
            role: NodeRole::Bus,
            ..
        }
    ));

    let permissive = Arc::new(
        TestDriver::new("parent", NodeRole::Virtual)
            .child_policy(ChildPolicy::unlimited([NodeRole::Bus])),
    );
    registry.register(permissive).expect("register permissive");
    let mut root = node("root", "root", "parent");
    root.children.push(node("child", "child", "test"));
    registry
        .validate(&device_tree::DeviceTreeDocument::new(root))
        .expect("explicit policy accepts Bus child");
}
