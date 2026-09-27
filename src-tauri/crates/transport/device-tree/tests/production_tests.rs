use acquisition::{
    AcquisitionBackend, AcquisitionRunState, ExecutionGate, TransportBackend, TransportConnection,
};
use async_trait::async_trait;
use data_model::device_tree::{NodeDecl, NodeId, NodeState, SIMULATION_DRIVER_ID};
use data_model::{TestDataConfig, TransportConfig};
use device_tree::{DeviceTreeAcquisition, DriverRegistry, NodeRole};
use flow::Direction;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use transport::device_driver::ByteDeviceDriver;
use transport::test_data::TestDataBackend;

fn test_data_node(id: &str, simulation: bool) -> NodeDecl {
    let defaults = serde_json::to_value(TransportConfig::TestData(TestDataConfig {
        sample_rate: 10.0,
        ..Default::default()
    }))
    .unwrap();
    let mut node = NodeDecl::leaf(id, id, "test-data", 1, defaults["params"].clone()).unwrap();
    node.capability_endpoint_id = Some("device".into());
    if simulation {
        node.children.push(
            NodeDecl::leaf(
                format!("{id}::simulation"),
                "simulation",
                SIMULATION_DRIVER_ID,
                1,
                serde_json::to_value(data_model::device::SimulationConfig {
                    channels: 1,
                    encoding: Some(serde_json::json!({
                        "protocol": {"kind": "RawData"},
                        "schema": null
                    })),
                    ..Default::default()
                })
                .unwrap(),
            )
            .unwrap(),
        );
    }
    node
}

fn id(value: &str) -> NodeId {
    NodeId::new(value).unwrap()
}

struct CountingBackend {
    opens: Arc<AtomicUsize>,
}

#[async_trait]
impl TransportBackend for CountingBackend {
    fn name(&self) -> &'static str {
        "counting-test-data"
    }

    fn accepts(&self, config: &TransportConfig) -> bool {
        TestDataBackend.accepts(config)
    }

    async fn open(
        &self,
        config: TransportConfig,
        link: schema_types::TestDataLink,
    ) -> error::Result<TransportConnection> {
        self.opens.fetch_add(1, Ordering::AcqRel);
        TestDataBackend.open(config, link).await
    }
}

fn runtime() -> DeviceTreeAcquisition {
    let registry = Arc::new(DriverRegistry::new());
    let execution = ExecutionGate::new(AcquisitionRunState::Running);
    registry
        .register(Arc::new(ByteDeviceDriver::new(
            "test-data",
            "Test Data",
            TransportConfig::TestData(TestDataConfig::default()),
            Arc::new(TestDataBackend),
            NodeRole::Virtual,
            execution.clone(),
        )))
        .expect("register native production driver");
    DeviceTreeAcquisition::with_execution(registry, execution)
}

#[tokio::test]
async fn test_data_uses_its_protocol_child_as_the_wire_encoding() {
    let runtime = runtime();
    let mut node = test_data_node("source", false);
    node.children.push(
        NodeDecl::leaf(
            "parser",
            "parser",
            "protocol-engine",
            1,
            serde_json::to_value(schema_types::ProtocolNodeConfig {
                protocol: schema_types::ProtocolConfig::FireWater { channels: Some(2) },
                convert_to: None,
                schema: schema_types::schema_from_protocol_config(
                    &schema_types::ProtocolConfig::FireWater { channels: Some(2) },
                ),
            })
            .unwrap(),
        )
        .unwrap(),
    );
    runtime.open_node(node).await.unwrap();
    assert!(matches!(
        runtime.snapshot(&id("parser")).unwrap().state,
        NodeState::Online { .. }
    ));
    let mut bytes = runtime.subscribe_flow(&id("source")).unwrap();
    let envelope = tokio::time::timeout(Duration::from_secs(1), bytes.recv())
        .await
        .unwrap()
        .unwrap();
    let text = std::str::from_utf8(&envelope.payload.bytes).expect("FireWater produces UTF-8 CSV");
    assert!(text.ends_with('\n'));
    assert!(text.contains(','));
    assert!(
        text.lines()
            .all(|line| line.split(',').all(|field| field.parse::<f32>().is_ok()))
    );
    runtime.close_node(&id("source")).await.unwrap();
}

#[tokio::test]
async fn disabled_protocol_child_remains_addressable_in_tree_snapshots() {
    let runtime = runtime();
    let mut node = test_data_node("source", false);
    let mut parser = NodeDecl::leaf(
        "disabled",
        "disabled",
        "protocol-engine",
        1,
        serde_json::to_value(schema_types::ProtocolNodeConfig {
            protocol: schema_types::ProtocolConfig::RawData,
            convert_to: None,
            schema: schema_types::schema_from_protocol_config(
                &schema_types::ProtocolConfig::RawData,
            ),
        })
        .unwrap(),
    )
    .unwrap();
    parser.enabled = false;
    node.children.push(parser);
    runtime.open_node(node).await.unwrap();
    assert_eq!(
        runtime.snapshot(&id("disabled")).unwrap().state,
        NodeState::Disabled
    );
    runtime.close_node(&id("source")).await.unwrap();
}

#[tokio::test]
async fn production_backend_uses_typed_byte_ports_and_idempotent_tree_close() {
    let runtime = runtime();
    let snapshot = runtime
        .open_node(test_data_node("source", false))
        .await
        .expect("open through device tree");
    assert!(matches!(
        snapshot.state,
        NodeState::Online {
            connection_epoch: 1
        }
    ));
    assert!(snapshot.capabilities.byte_source);
    assert!(snapshot.capabilities.byte_sink);

    let mut bytes = runtime
        .subscribe_flow(&id("source"))
        .expect("typed byte source");
    runtime
        .send(&id("source"), &[1, 2, 3])
        .expect("typed byte sink");
    let loopback = tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let envelope = bytes.recv().await.expect("loopback closed");
            if envelope.direction == Direction::Transmit {
                break envelope;
            }
        }
    })
    .await
    .expect("loopback timeout");
    assert_eq!(loopback.direction, Direction::Transmit);
    assert_eq!(loopback.payload.bytes.as_ref(), [1, 2, 3]);
    assert_eq!(runtime.stats(&id("source")).expect("stats").tx_bytes, 3);

    runtime.close_node(&id("source")).await.unwrap();
    runtime.close_node(&id("source")).await.unwrap();
    assert!(runtime.list_open().is_empty());
}

#[tokio::test]
async fn production_simulation_uses_virtual_child_without_opening_parent_source() {
    let registry = Arc::new(DriverRegistry::new());
    let execution = ExecutionGate::new(AcquisitionRunState::Running);
    let opens = Arc::new(AtomicUsize::new(0));
    registry
        .register(Arc::new(ByteDeviceDriver::new(
            "test-data",
            "Test Data",
            TransportConfig::TestData(TestDataConfig::default()),
            Arc::new(CountingBackend {
                opens: opens.clone(),
            }),
            NodeRole::Virtual,
            execution.clone(),
        )))
        .expect("register native production driver");
    let runtime = DeviceTreeAcquisition::with_execution(registry, execution);

    let snapshot = runtime
        .open_node(test_data_node("simulated", true))
        .await
        .expect("open simulated subtree");
    assert!(matches!(
        snapshot.state,
        NodeState::Online {
            connection_epoch: 1
        }
    ));
    assert!(runtime.send(&id("simulated"), &[1]).is_err());
    assert_eq!(opens.load(Ordering::Acquire), 0);

    let mut bytes = runtime
        .subscribe_flow(&id("simulated"))
        .expect("simulation byte source");
    let generated = tokio::time::timeout(Duration::from_secs(1), bytes.recv())
        .await
        .expect("simulation timeout")
        .expect("simulation closed");
    assert_eq!(generated.direction, Direction::Receive);

    let nodes = runtime.device_tree_nodes();
    assert_eq!(nodes.as_array().expect("node array").len(), 2);
    assert!(nodes.to_string().contains("simulated::simulation"));
    assert!(!nodes.to_string().contains(r#""nodeId":"root""#));
    assert!(
        runtime
            .driver_manifests()
            .to_string()
            .contains(r#""driverId":"test-data""#)
    );

    runtime.close(&id("simulated")).await;
    assert!(runtime.list_open().is_empty());
    assert_eq!(opens.load(Ordering::Acquire), 0);
}
