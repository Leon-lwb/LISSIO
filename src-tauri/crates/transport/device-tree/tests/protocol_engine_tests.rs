use acquisition::PortDescriptor;
use async_trait::async_trait;
use data_model::device_tree::{DriverId, NodeId, NodePath, NodeRole, NodeState};
use device_tree::{
    ByteSourceCapability, Capability, CapabilityMask, CloseError, ConfigError, DriverRegistry,
    FrameSubscription, NodeContext, NodeDriver, NodeRuntime, ParentContract, ProtocolEngineDriver,
    RuntimeCapabilities,
};
use flow::{BytesChunk, Direction, FlowEnvelope, FlowGap, Framing, LostUnit, SourceId};
use schema_types::ProtocolNodeConfig;
use serde_json::json;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::Duration;
use tokio::sync::broadcast;

#[test]
fn protocol_requires_a_byte_parent_and_a_valid_protocol_config() {
    let driver = ProtocolEngineDriver::new();
    let config = serde_json::to_value(ProtocolNodeConfig::default()).unwrap();
    assert!(matches!(
        driver.validate(&config, None),
        Err(ConfigError::MissingParentCapability {
            capability: Capability::ByteSource,
            ..
        })
    ));
    let mut parent = ParentContract {
        role: NodeRole::Virtual,
        capabilities: CapabilityMask::empty(),
        port_descriptors: vec![],
    };
    assert!(driver.validate(&config, Some(&parent)).is_err());
    parent.capabilities.byte_source = true;
    assert!(driver.validate(&config, Some(&parent)).is_ok());
    assert!(
        driver
            .validate(&json!({"protocol": {"kind": "Unknown"}}), Some(&parent))
            .is_err()
    );
    assert!(driver.validate(&json!({}), Some(&parent)).is_err());
}

#[test]
fn builtin_catalog_exposes_protocol_defaults_and_child_policy() {
    let registry = DriverRegistry::new();
    let manifest = registry
        .manifests()
        .into_iter()
        .find(|manifest| manifest.driver_id.as_str() == "protocol-engine")
        .unwrap();
    assert_eq!(manifest.role, NodeRole::Protocol);
    assert!(manifest.capabilities.byte_source);
    assert!(!manifest.capabilities.read);
    assert!(
        manifest
            .child_policy
            .allowed
            .contains_key(&NodeRole::Protocol)
    );
    let default = &manifest.config_schema.json_schema["default"];
    let config: ProtocolNodeConfig = serde_json::from_value(default.clone()).unwrap();
    assert_eq!(config, ProtocolNodeConfig::default());
    assert_eq!(
        default["protocol"],
        manifest.config_schema.json_schema["properties"]["protocol"]["default"]
    );
    assert!(
        serde_json::to_value(manifest).unwrap()["childPolicy"]["allowed"]["protocol"].is_object()
    );
    for role in [NodeRole::Bus, NodeRole::Virtual] {
        assert!(
            device_tree::source_child_policy(role)
                .allowed
                .contains_key(&NodeRole::Protocol)
        );
    }
    assert!(
        device_tree::SimulationDriver::new()
            .child_policy()
            .allowed
            .contains_key(&NodeRole::Protocol)
    );
}

#[tokio::test]
async fn nested_protocols_preserve_raw_metadata_and_close_independently() {
    let parent = Arc::new(ByteParent::new(16));
    let protocol = open("protocol", parent.clone()).await;
    let nested = open("nested", protocol.clone()).await;
    let mut raw = parent.subscribe_bytes();
    let mut bytes = nested.as_byte_source().unwrap().subscribe_bytes();
    let mut expected = envelope(9);
    expected.gap_before = Some(FlowGap {
        first_missing_sequence: 7,
        last_missing_sequence: 8,
        lost_units: Some(2),
        unit: LostUnit::Messages,
    });
    parent.bytes.send(expected.clone()).unwrap();
    assert_eq!(receive(&mut bytes).await.unwrap(), expected);
    assert_eq!(receive(&mut raw).await.unwrap(), expected);
    parent.epoch.store(12, Ordering::Release);
    assert_eq!(
        nested.state(),
        NodeState::Online {
            connection_epoch: 12
        }
    );
    nested.close().await.unwrap();
    nested.close().await.unwrap();
    assert_eq!(nested.state(), NodeState::Closed);
    assert!(receive(&mut bytes).await.is_err());
    assert!(
        receive(&mut nested.as_byte_source().unwrap().subscribe_bytes())
            .await
            .is_err()
    );
    assert_eq!(
        protocol.state(),
        NodeState::Online {
            connection_epoch: 12
        }
    );
    assert_eq!(parent.close_count.load(Ordering::Acquire), 0);
    parent.bytes.send(envelope(10)).unwrap();
    assert_eq!(receive(&mut raw).await.unwrap().first_sequence, 10);
    protocol.close().await.unwrap();
    assert_eq!(parent.close_count.load(Ordering::Acquire), 0);
}

#[tokio::test]
async fn lagged_parent_bytes_retain_a_discontinuity_marker() {
    let parent = Arc::new(ByteParent::new(2));
    let protocol = open("protocol", parent.clone()).await;
    let mut bytes = protocol.as_byte_source().unwrap().subscribe_bytes();
    // 当前线程尚未调度转发任务，确定性地使上游广播产生缺口。
    for sequence in 0..4 {
        parent.bytes.send(envelope(sequence)).unwrap();
    }
    let received = receive(&mut bytes).await.unwrap();
    assert_eq!(received.first_sequence, 2);
    let gap = received.gap_before.unwrap();
    assert_eq!(gap.first_missing_sequence, 0);
    assert_eq!(gap.last_missing_sequence, 1);
    assert_eq!(gap.unit, LostUnit::Messages);
    protocol.close().await.unwrap();
}

async fn receive(
    subscription: &mut FrameSubscription<FlowEnvelope<BytesChunk>>,
) -> Result<FlowEnvelope<BytesChunk>, broadcast::error::RecvError> {
    tokio::time::timeout(Duration::from_secs(1), subscription.recv())
        .await
        .expect("byte subscription timeout")
}

async fn open(id: &str, parent: Arc<dyn NodeRuntime>) -> Arc<dyn NodeRuntime> {
    let driver = ProtocolEngineDriver::new();
    let config = serde_json::to_value(ProtocolNodeConfig::default()).unwrap();
    let contract = ParentContract::from_runtime(NodeRole::Bus, parent.as_ref());
    driver
        .open(
            driver.validate(&config, Some(&contract)).unwrap(),
            Some(parent),
            NodeContext::new(
                NodeId::new(id).unwrap(),
                NodePath::root(id).unwrap(),
                1,
                broadcast::channel(1).0,
            ),
        )
        .await
        .unwrap()
}

fn envelope(sequence: u64) -> FlowEnvelope<BytesChunk> {
    FlowEnvelope {
        source_id: SourceId::new("parent").unwrap(),
        connection_epoch: 4,
        first_sequence: sequence,
        last_sequence: sequence,
        observed_time_unix_ns: 100,
        direction: Direction::Receive,
        gap_before: None,
        payload: BytesChunk::complete(vec![1, 2, 3], Framing::Datagram),
    }
}

struct ByteParent {
    id: NodeId,
    path: NodePath,
    driver: DriverId,
    epoch: AtomicU64,
    close_count: AtomicUsize,
    bytes: broadcast::Sender<FlowEnvelope<BytesChunk>>,
}

impl ByteParent {
    fn new(capacity: usize) -> Self {
        Self {
            id: NodeId::new("parent").unwrap(),
            path: NodePath::root("parent").unwrap(),
            driver: DriverId::new("byte-parent"),
            epoch: AtomicU64::new(4),
            close_count: AtomicUsize::new(0),
            bytes: broadcast::channel(capacity).0,
        }
    }
}

impl RuntimeCapabilities for ByteParent {
    fn capability_projection(&self) -> CapabilityMask {
        CapabilityMask::only(Capability::ByteSource)
    }
}

#[async_trait]
impl NodeRuntime for ByteParent {
    fn node_id(&self) -> &NodeId {
        &self.id
    }
    fn path(&self) -> &NodePath {
        &self.path
    }
    fn driver(&self) -> &DriverId {
        &self.driver
    }
    fn state(&self) -> NodeState {
        NodeState::Online {
            connection_epoch: self.epoch.load(Ordering::Acquire),
        }
    }
    fn port_descriptors(&self) -> &[PortDescriptor] {
        &[]
    }
    fn as_byte_source(&self) -> Option<&dyn ByteSourceCapability> {
        Some(self)
    }
    async fn close(&self) -> Result<(), CloseError> {
        self.close_count.fetch_add(1, Ordering::AcqRel);
        Ok(())
    }
}

#[async_trait]
impl ByteSourceCapability for ByteParent {
    fn subscribe_bytes(&self) -> FrameSubscription<FlowEnvelope<BytesChunk>> {
        FrameSubscription::from_receiver(self.bytes.subscribe())
    }
}
