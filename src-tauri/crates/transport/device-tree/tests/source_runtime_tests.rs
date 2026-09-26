#[path = "support/session_driver.rs"]
mod session_driver;
use session_driver::SessionDriver;

use acquisition::{
    AdapterCapability, ByteMessage, CapabilitySet, DriverManifest, DriverSchema,
    EndpointDescriptor, EndpointDirection, InvokeCapability, PortDescriptor, PortDirection,
    ProtocolKind, ReadCapability, RuntimeState, RuntimeStatus, SessionCapabilities, SourceFactory,
    SourceSession, TransportConnection, TransportKind, ValidatedConfig, WriteCapability,
};
use async_trait::async_trait;
use data_model::ConfigurationSchema;
use data_model::device::{DriverId, DriverPayload, SimulationConfig};
use device_tree::{
    CapabilityMask, DeviceTree, DriverRegistry, NodeContext, NodeDecl, NodeDriver, NodeId,
    NodePath, NodeRole, NodeState,
};
use flow::{Direction, FlowEnvelope, SourceId};
use points::{
    AccessLevel, DeliveryClass, NativeAddress, PointBatch, PointDataType, PointDescriptor,
    PointEnvelope, PointId, ReadRequest, ReadResult, WriteRequest, WriteResult,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{broadcast, mpsc, watch};

#[tokio::test]
async fn runtime_preserves_validated_state_capabilities_ports_and_point_epoch() {
    let factory = Arc::new(TestFactory::new());
    let adapter = SessionDriver::new(factory.clone(), NodeRole::Endpoint);
    let validated = adapter
        .validate(&json!({"value": 7}), None)
        .expect("fixture validation");
    assert_eq!(factory.validate_calls.load(Ordering::Acquire), 1);
    assert_eq!(factory.descriptor_calls.load(Ordering::Acquire), 1);

    let runtime = adapter
        .open(
            validated,
            None,
            NodeContext::new(
                NodeId::new("source").expect("id"),
                NodePath::root("source").expect("path"),
                7,
                tokio::sync::broadcast::channel(1).0,
            ),
        )
        .await
        .expect("fixture open");
    assert_eq!(factory.open_calls.load(Ordering::Acquire), 1);
    assert_eq!(
        runtime.capability_projection(),
        CapabilityMask {
            read: true,
            write: true,
            invoke: true,
            ..CapabilityMask::empty()
        }
    );
    assert_eq!(runtime.port_descriptors().len(), 1);
    assert!(matches!(
        runtime.state(),
        NodeState::Online {
            connection_epoch: 7
        }
    ));

    let result = runtime
        .as_reader()
        .expect("read projection")
        .read(ReadRequest { points: Vec::new() })
        .await
        .expect("read");
    assert_eq!(result.batch.connection_epoch, 7);

    factory.read_epoch.store(99, Ordering::Release);
    assert!(matches!(
        runtime
            .as_reader()
            .expect("read projection")
            .read(ReadRequest { points: Vec::new() })
            .await,
        Err(acquisition::AcquisitionError::Closed)
    ));

    let invoked = runtime
        .as_invoker()
        .expect("invoke projection")
        .invoke("ping", json!({}))
        .await
        .expect("invoke");
    assert_eq!(invoked, json!({"ok": true}));

    runtime.close().await.expect("close");
    runtime.close().await.expect("close remains idempotent");
    assert_eq!(factory.close_calls.load(Ordering::Acquire), 1);
    assert_eq!(runtime.state(), NodeState::Closed);
}

#[tokio::test]
async fn runtime_rejects_old_epoch_byte_writes_and_preserves_byte_source() {
    let factory = Arc::new(TestFactory::with_byte_stream());
    let adapter = SessionDriver::new(factory.clone(), NodeRole::Bus);
    let validated = adapter
        .validate(&json!({}), None)
        .expect("fixture validation");
    let runtime = adapter
        .open(
            validated,
            None,
            NodeContext::new(
                NodeId::new("byte-source").expect("id"),
                NodePath::root("byte-source").expect("path"),
                4,
                tokio::sync::broadcast::channel(1).0,
            ),
        )
        .await
        .expect("fixture open");

    let mut subscription = runtime
        .as_byte_source()
        .expect("byte source projection")
        .subscribe_bytes();
    factory.send_bytes(1);
    let envelope = subscription.recv().await.expect("byte envelope");
    assert_eq!(envelope.connection_epoch, 4);
    assert_eq!(envelope.payload.bytes.as_ref(), &[1]);

    let stale = FlowEnvelope {
        source_id: SourceId::new("byte-source").expect("source id"),
        connection_epoch: 3,
        first_sequence: 2,
        last_sequence: 2,
        observed_time_unix_ns: 0,
        direction: Direction::Transmit,
        gap_before: None,
        payload: flow::BytesChunk::complete(vec![2], flow::Framing::Stream),
    };
    assert!(
        runtime
            .as_byte_sink()
            .expect("byte sink projection")
            .send_bytes(&stale)
            .await
            .is_err()
    );

    let current = FlowEnvelope {
        connection_epoch: 4,
        ..stale
    };
    runtime
        .as_byte_sink()
        .expect("byte sink projection")
        .send_bytes(&current)
        .await
        .expect("current epoch write");
    runtime.close().await.unwrap();
    let sink = runtime.as_byte_sink().unwrap();
    assert!(sink.try_send_bytes(&current).is_err());
    assert!(sink.send_bytes(&current).await.is_err());
}

#[tokio::test]
async fn byte_subscription_preserves_fixture_gap_metadata() {
    let factory = Arc::new(TestFactory::with_byte_stream());
    let adapter = SessionDriver::new(factory.clone(), NodeRole::Bus);
    let validated = adapter
        .validate(&json!({}), None)
        .expect("fixture validation");
    let runtime = adapter
        .open(
            validated,
            None,
            NodeContext::new(
                NodeId::new("byte-gap").expect("id"),
                NodePath::root("byte-gap").expect("path"),
                4,
                tokio::sync::broadcast::channel(1).0,
            ),
        )
        .await
        .expect("fixture open");

    let mut subscription = runtime
        .as_byte_source()
        .expect("byte source projection")
        .subscribe_bytes();
    factory.send_burst(&[1, 2, 3]);
    let envelope = subscription.recv().await.expect("byte envelope");
    let gap = envelope.gap_before.expect("fixture lag gap");
    assert_eq!(gap.first_missing_sequence, 0);
    assert_eq!(gap.last_missing_sequence, 1);
    assert_eq!(gap.lost_units, Some(2));
    assert_eq!(envelope.payload.bytes.as_ref(), &[3]);
}

#[tokio::test]
async fn driver_registry_projects_capabilities_schema_ports_points_and_discovery() {
    let factory = Arc::new(TestFactory::new());
    let registry = Arc::new(DriverRegistry::new());
    registry
        .register(Arc::new(SessionDriver::new(factory, NodeRole::Endpoint)))
        .expect("register fixture source");
    let driver_id = device_tree::DriverId::new("fixture");
    let projection = registry
        .capability_projection(&driver_id, &json!({"value": 7}), None)
        .expect("driver projection");
    assert_eq!(projection.driver_id, driver_id);
    assert_eq!(projection.role, NodeRole::Endpoint);
    assert!(projection.capabilities.read);
    assert!(projection.capabilities.write);
    assert!(projection.capabilities.invoke);
    assert_eq!(projection.config_schema.schema_version, 7);
    assert_eq!(projection.ports.len(), 1);
    assert_eq!(registry.adapter_capabilities().len(), 1);
    assert_eq!(
        registry
            .point_descriptors(&driver_id, &json!({"value": 7}))
            .expect("point descriptors")
            .len(),
        1
    );
    assert!(
        registry
            .discover(&driver_id)
            .expect("discovery projection")
            .is_empty()
    );
}

#[tokio::test]
async fn supervisor_reconnects_with_a_new_epoch_and_rejects_old_writes() {
    let factory = Arc::new(TestFactory::new());
    let adapter = SessionDriver::new(factory.clone(), NodeRole::Endpoint).with_supervisor(
        acquisition::SourceSupervisor {
            max_reconnect_attempts: 2,
            initial_backoff: Duration::from_millis(1),
            max_backoff: Duration::from_millis(4),
        },
    );
    let validated = adapter
        .validate(&json!({"value": 7}), None)
        .expect("fixture validation");
    let runtime = adapter
        .open(
            validated,
            None,
            NodeContext::new(
                NodeId::new("supervised").expect("id"),
                NodePath::root("supervised").expect("path"),
                4,
                tokio::sync::broadcast::channel(1).0,
            ),
        )
        .await
        .expect("supervised open");
    assert!(matches!(
        runtime.state(),
        NodeState::Online {
            connection_epoch: 4
        }
    ));
    factory.trigger_stop();
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if factory.open_calls.load(Ordering::Acquire) >= 2
                && matches!(
                    runtime.state(),
                    NodeState::Online {
                        connection_epoch: 5
                    }
                )
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("supervisor reconnect");
    runtime.close().await.expect("close supervised runtime");
    runtime.close().await.expect("close remains idempotent");
    assert_eq!(factory.close_calls.load(Ordering::Acquire), 2);
}

#[tokio::test]
async fn byte_subscription_follows_supervised_session_reconnect() {
    let factory = Arc::new(TestFactory::with_byte_stream());
    let adapter = SessionDriver::new(factory.clone(), NodeRole::Bus).with_supervisor(
        acquisition::SourceSupervisor {
            max_reconnect_attempts: 2,
            initial_backoff: Duration::from_millis(1),
            max_backoff: Duration::from_millis(4),
        },
    );
    let runtime = adapter
        .open(
            adapter.validate(&json!({}), None).unwrap(),
            None,
            NodeContext::new(
                NodeId::new("reconnecting-bytes").unwrap(),
                NodePath::root("reconnecting-bytes").unwrap(),
                4,
                tokio::sync::broadcast::channel(1).0,
            ),
        )
        .await
        .unwrap();
    let mut subscription = runtime.as_byte_source().unwrap().subscribe_bytes();
    factory.send_bytes(0x11);
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), subscription.recv())
            .await
            .unwrap()
            .unwrap()
            .connection_epoch,
        4
    );

    factory.trigger_stop();
    tokio::time::timeout(Duration::from_secs(1), async {
        while !matches!(
            runtime.state(),
            NodeState::Online {
                connection_epoch: 5
            }
        ) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("reconnected");
    factory.send_bytes(0x22);
    let received = tokio::time::timeout(Duration::from_secs(1), subscription.recv())
        .await
        .expect("same subscription receives after reconnect")
        .unwrap();
    assert_eq!(received.connection_epoch, 5);
    assert_eq!(received.payload.bytes.as_ref(), &[0x22]);
    runtime.close().await.unwrap();
}

#[tokio::test]
async fn simulation_child_is_a_typed_virtual_subtree_with_idempotent_close() {
    let factory = Arc::new(TestFactory::new());
    let registry = Arc::new(DriverRegistry::new());
    registry
        .register(Arc::new(SessionDriver::new(
            factory.clone(),
            NodeRole::Endpoint,
        )))
        .expect("register fixture source");

    let mut source =
        NodeDecl::leaf("source", "source", "fixture", 7, json!({"value": 7})).expect("source node");
    source.children.push(
        NodeDecl::leaf(
            "source::simulation",
            "simulation",
            data_model::device_tree::SIMULATION_DRIVER_ID,
            device_tree::DEVICE_TREE_SCHEMA_VERSION,
            serde_json::to_value(SimulationConfig::default()).expect("simulation config"),
        )
        .expect("simulation node"),
    );
    let mut root = NodeDecl::leaf("root", "root", device_tree::ROOT_DRIVER_ID, 1, json!({}))
        .expect("root node");
    root.children.push(source);

    let tree = DeviceTree::new(registry)
        .open(device_tree::DeviceTreeDocument::new(root))
        .await
        .expect("open simulated subtree");
    let snapshots = tree.snapshots();
    assert_eq!(snapshots.len(), 3);
    assert!(matches!(snapshots[1].state, NodeState::Online { .. }));
    assert!(matches!(snapshots[2].state, NodeState::Online { .. }));
    assert!(snapshots[2].capabilities.read);
    assert!(snapshots[2].capabilities.subscribe);

    let simulation = tree
        .runtime(&NodeId::new("source::simulation").expect("simulation id"))
        .expect("simulation runtime");
    let result = simulation
        .as_reader()
        .expect("simulation read projection")
        .read(ReadRequest {
            points: vec![PointId("point".into())],
        })
        .await
        .expect("simulation read");
    assert_eq!(result.batch.connection_epoch, 1);

    tree.close().await.expect("close simulated subtree");
    tree.close().await.expect("close remains idempotent");
    assert_eq!(factory.open_calls.load(Ordering::Acquire), 0);
    assert_eq!(factory.close_calls.load(Ordering::Acquire), 0);
}

struct TestFactory {
    manifest: DriverManifest,
    schema: DriverSchema,
    capability: AdapterCapability,
    validate_calls: Arc<AtomicUsize>,
    descriptor_calls: Arc<AtomicUsize>,
    open_calls: Arc<AtomicUsize>,
    close_calls: Arc<AtomicUsize>,
    read_epoch: Arc<AtomicU64>,
    byte_source: bool,
    capabilities: SessionCapabilities,
    byte_data: Option<broadcast::Sender<ByteMessage>>,
    byte_write: Option<mpsc::Sender<Vec<u8>>>,
    byte_write_rx: Arc<Mutex<Option<mpsc::Receiver<Vec<u8>>>>>,
    stop: Arc<watch::Sender<bool>>,
}

impl TestFactory {
    fn new() -> Self {
        Self::with_options(
            false,
            CapabilitySet {
                read: true,
                write: true,
                method: true,
                ..CapabilitySet::default()
            },
        )
    }

    fn with_byte_stream() -> Self {
        Self::with_options(
            true,
            CapabilitySet {
                byte_source: true,
                byte_sink: true,
                ..CapabilitySet::default()
            },
        )
    }

    fn with_options(byte_source: bool, operations: CapabilitySet) -> Self {
        let manifest = DriverManifest {
            id: DriverId::new("fixture"),
            display_name: "Session fixture".into(),
            payload_kinds: BTreeSet::from([flow::PayloadKind::Bytes]),
            capabilities: operations,
        };
        let schema = DriverSchema {
            schema_version: 7,
            json_schema: json!({"type": "object"}),
            ui_hints: json!({}),
        };
        let capability = AdapterCapability {
            contract_version: 1,
            adapter_id: manifest.id.clone(),
            display_name: manifest.display_name.clone(),
            protocol: ProtocolKind::Bytes,
            transport: TransportKind::Tcp,
            direction: EndpointDirection::Client,
            operations,
            data_domains: manifest.payload_kinds.clone(),
            endpoints: vec![EndpointDescriptor {
                id: "source".into(),
                display_name: "source".into(),
                transport: TransportKind::Tcp,
                direction: EndpointDirection::Client,
                status: RuntimeStatus {
                    state: RuntimeState::Available,
                    detail: None,
                },
                ports: vec![PortDescriptor {
                    id: "stream".into(),
                    display_name: "stream".into(),
                    direction: PortDirection::Bidirectional,
                    data_domain: flow::PayloadKind::Bytes,
                    operations,
                    address_space: None,
                    data_types: BTreeSet::new(),
                    display: None,
                }],
                configuration: ConfigurationSchema {
                    schema_version: 7,
                    json_schema: json!({"type": "object"}),
                    ui_hints: json!({}),
                },
                display: None,
            }],
            display: None,
        };
        let (stop, _) = watch::channel(false);
        let (byte_data, byte_write, byte_write_rx) = if byte_source {
            let (data, _) = broadcast::channel(1);
            let (write, write_rx) = mpsc::channel(8);
            (
                Some(data),
                Some(write),
                Arc::new(Mutex::new(Some(write_rx))),
            )
        } else {
            (None, None, Arc::new(Mutex::new(None)))
        };
        Self {
            manifest,
            schema,
            capability,
            validate_calls: Arc::new(AtomicUsize::new(0)),
            descriptor_calls: Arc::new(AtomicUsize::new(0)),
            open_calls: Arc::new(AtomicUsize::new(0)),
            close_calls: Arc::new(AtomicUsize::new(0)),
            read_epoch: Arc::new(AtomicU64::new(7)),
            byte_source,
            capabilities: SessionCapabilities {
                available: operations,
                max_read_points: 1,
                max_write_points: 1,
                min_period_ms: None,
                max_period_ms: None,
                source_timestamps: false,
                server_timestamps: false,
                idempotent_writes: false,
            },
            byte_data,
            byte_write,
            byte_write_rx,
            stop: Arc::new(stop),
        }
    }

    fn trigger_stop(&self) {
        self.stop.send_replace(true);
    }

    fn send_burst(&self, values: &[u8]) {
        for value in values {
            self.send_bytes(*value);
        }
    }

    fn send_bytes(&self, value: u8) {
        self.byte_data
            .as_ref()
            .expect("byte factory")
            .send(ByteMessage::from_device(vec![value]))
            .expect("byte subscriber");
    }
}

#[async_trait]
impl SourceFactory for TestFactory {
    fn manifest(&self) -> &DriverManifest {
        &self.manifest
    }

    fn config_schema(&self) -> DriverSchema {
        self.schema.clone()
    }

    fn adapter_capability(&self) -> AdapterCapability {
        self.capability.clone()
    }

    fn validate(&self, _input: &DriverPayload) -> acquisition::AcquisitionResult<ValidatedConfig> {
        self.validate_calls.fetch_add(1, Ordering::AcqRel);
        let open_calls = self.open_calls.clone();
        let close_calls = self.close_calls.clone();
        let read_epoch = self.read_epoch.clone();
        let byte_source = self.byte_source;
        let capabilities = self.capabilities.clone();
        let byte_data = self.byte_data.clone();
        let byte_write = self.byte_write.clone();
        let byte_write_rx = self.byte_write_rx.clone();
        let stop = self.stop.subscribe();
        self.stop.send_replace(false);
        Ok(ValidatedConfig::new(
            self.manifest.id.clone(),
            move |context| {
                Box::pin(async move {
                    open_calls.fetch_add(1, Ordering::AcqRel);
                    let byte_handle = byte_data.zip(byte_write).map(|(data, write)| {
                        acquisition::handle::TransportHandle::new(
                            TransportConnection::from_cancel_flag(
                                write,
                                data,
                                Arc::new(AtomicBool::new(false)),
                            ),
                            data_model::TransportConfig::TcpClient(
                                data_model::TcpClientConfig::default(),
                            ),
                            context.connection_epoch,
                        )
                    });
                    let byte_write_receiver =
                        byte_write_rx.lock().expect("write receiver lock").take();
                    Ok(Box::new(TestSession {
                        epoch: context.connection_epoch,
                        read_epoch,
                        close_calls,
                        byte_source,
                        capabilities,
                        byte_handle,
                        byte_write_receiver,
                        stop,
                    }) as Box<dyn SourceSession>)
                })
            },
        ))
    }

    fn point_descriptors(
        &self,
        _input: &DriverPayload,
    ) -> acquisition::AcquisitionResult<Vec<PointDescriptor>> {
        self.descriptor_calls.fetch_add(1, Ordering::AcqRel);
        Ok(vec![PointDescriptor {
            id: PointId("point".into()),
            path: vec!["point".into()],
            name: "point".into(),
            data_type: PointDataType::F64,
            access: AccessLevel::ReadOnly,
            engineering_unit: None,
            semantic: BTreeMap::new(),
            native_address: NativeAddress {
                domain: "test".into(),
                value: json!({}),
            },
        }])
    }
}

struct TestSession {
    epoch: u64,
    read_epoch: Arc<AtomicU64>,
    close_calls: Arc<AtomicUsize>,
    byte_source: bool,
    capabilities: SessionCapabilities,
    byte_handle: Option<acquisition::handle::TransportHandle>,
    // Keep the fixture write channel receiver alive for the session lifetime.
    #[allow(dead_code)]
    byte_write_receiver: Option<mpsc::Receiver<Vec<u8>>>,
    stop: watch::Receiver<bool>,
}

impl TestSession {
    fn envelope(epoch: u64) -> PointEnvelope {
        FlowEnvelope {
            source_id: SourceId::new("source").expect("source id"),
            connection_epoch: epoch,
            first_sequence: 0,
            last_sequence: 0,
            observed_time_unix_ns: 0,
            direction: Direction::Receive,
            gap_before: None,
            payload: PointBatch {
                delivery: DeliveryClass::State,
                samples: Vec::new(),
            },
        }
    }
}

#[async_trait]
impl SourceSession for TestSession {
    fn epoch(&self) -> u64 {
        self.epoch
    }

    fn capabilities(&self) -> &SessionCapabilities {
        &self.capabilities
    }

    fn byte_stream(&self) -> Option<&acquisition::handle::TransportHandle> {
        self.byte_handle.as_ref()
    }

    fn reader(&self) -> Option<&dyn ReadCapability> {
        (!self.byte_source).then_some(self)
    }

    fn writer(&self) -> Option<&dyn WriteCapability> {
        (!self.byte_source).then_some(self)
    }

    fn invoker(&self) -> Option<&dyn InvokeCapability> {
        (!self.byte_source).then_some(self)
    }

    async fn stopped(&self) -> acquisition::AcquisitionResult<()> {
        let mut stop = self.stop.clone();
        while !*stop.borrow() {
            if stop.changed().await.is_err() {
                break;
            }
        }
        Ok(())
    }

    async fn close(&self) -> acquisition::AcquisitionResult<()> {
        self.close_calls.fetch_add(1, Ordering::AcqRel);
        Ok(())
    }
}

#[async_trait]
impl ReadCapability for TestSession {
    async fn read(&self, _request: ReadRequest) -> acquisition::AcquisitionResult<ReadResult> {
        let epoch = self.read_epoch.load(Ordering::Acquire);
        Ok(ReadResult {
            batch: Self::envelope(epoch),
        })
    }
}

#[async_trait]
impl WriteCapability for TestSession {
    async fn write(&self, request: WriteRequest) -> acquisition::AcquisitionResult<WriteResult> {
        Ok(WriteResult {
            correlation_id: request.correlation_id,
            items: Vec::new(),
        })
    }
}

#[async_trait]
impl InvokeCapability for TestSession {
    async fn invoke(&self, _method: &str, _args: Value) -> acquisition::AcquisitionResult<Value> {
        Ok(json!({"ok": true}))
    }
}

#[tokio::test]
async fn invalid_session_contract_closes_the_opened_session() {
    let factory = Arc::new(TestFactory::with_options(false, CapabilitySet::default()));
    let driver = SessionDriver::new(factory.clone(), NodeRole::Endpoint);
    let config = driver.validate(&json!({}), None).unwrap();
    let context = NodeContext::new(
        NodeId::new("invalid").unwrap(),
        NodePath::root("invalid").unwrap(),
        1,
        broadcast::channel(1).0,
    );
    assert!(driver.open(config, None, context).await.is_err());
    assert_eq!(factory.open_calls.load(Ordering::Acquire), 1);
    assert_eq!(factory.close_calls.load(Ordering::Acquire), 1);
}
