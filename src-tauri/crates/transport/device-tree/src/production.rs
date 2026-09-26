//! 设备树生产采集后端 — NodeDecl 到 typed 节点运行时的稳定桥接。

#[path = "production_support.rs"]
mod support;

use crate::model::{NodeDecl, NodeId, NodeSnapshot};
use crate::registry::DriverRegistry;
use crate::runtime::DeviceTree;
use acquisition::{
    AcquisitionBackend, AcquisitionError, AcquisitionResult, AcquisitionRunState,
    AdapterCapability, DiscoveredEndpoint, EffectiveSubscription, ExecutionGate, FlowReceiver,
    LiveNodeHandle, PointBatchObserver, StateLane, SubscriptionIntent,
};
use async_trait::async_trait;
use data_model::device::DriverPayload;
use data_model::device_tree::DriverId;
use data_model::{ConnectionState, Result, TestDataConfig, TransportConfig, TransportStats};
use flow::{BytesChunk, FlowEnvelope, Framing, SourceId};
use parking_lot::{Mutex, RwLock};
use points::{
    PointDescriptor, PointId, PointSample, ReadRequest, ReadResult, WriteRequest, WriteResult,
};
use schema_types::TestDataLink;
use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use support::{
    NodeEntry, NodeResource, OpeningEntry, byte_session, connection_state, effective_node_id,
    error_text, node_points, only_simulation_changed, open_error, simulation_config,
    spawn_sample_consumer, validate_node,
};
use tokio::sync::mpsc;

const SAMPLE_CHANNEL_CAPACITY: usize = 256;
const SAMPLE_CACHE_POINTS: usize = 16_384;
const SAMPLE_CACHE_BYTES: usize = 16 * 1024 * 1024;

/// 由 [`DriverRegistry`] 和 [`crate::runtime::DeviceTreeRuntime`] 承担生产节点生命周期。
pub struct DeviceTreeAcquisition {
    registry: Arc<DriverRegistry>,
    tree: DeviceTree,
    nodes: RwLock<BTreeMap<NodeId, Arc<NodeEntry>>>,
    opening: Mutex<BTreeMap<NodeId, OpeningEntry>>,
    execution: ExecutionGate,
    observer: RwLock<Option<Arc<dyn PointBatchObserver>>>,
}

impl DeviceTreeAcquisition {
    pub fn new(registry: Arc<DriverRegistry>) -> Self {
        Self::with_execution(registry, ExecutionGate::new(AcquisitionRunState::Stopped))
    }

    pub fn with_execution(registry: Arc<DriverRegistry>, execution: ExecutionGate) -> Self {
        Self {
            tree: DeviceTree::new(registry.clone()),
            registry,
            nodes: RwLock::new(BTreeMap::new()),
            opening: Mutex::new(BTreeMap::new()),
            execution,
            observer: RwLock::new(None),
        }
    }

    pub const fn registry(&self) -> &Arc<DriverRegistry> {
        &self.registry
    }

    fn entry_for_node(&self, node_id: &NodeId) -> AcquisitionResult<Arc<NodeEntry>> {
        if let Some(entry) = self.nodes.read().get(node_id) {
            return Ok(entry.clone());
        }
        self.nodes
            .read()
            .values()
            .find(|entry| entry.resources.contains_key(node_id))
            .cloned()
            .ok_or_else(|| AcquisitionError::UnknownNode(node_id.to_string()))
    }

    fn operation_node_id(entry: &NodeEntry, node_id: &NodeId) -> NodeId {
        if *node_id == entry.root_id {
            entry.effective_node_id.clone()
        } else {
            node_id.clone()
        }
    }

    async fn install(
        &self,
        declaration: NodeDecl,
        canceled: Arc<AtomicBool>,
    ) -> AcquisitionResult<NodeSnapshot> {
        let root_id = declaration.id.clone();
        let effective = effective_node_id(&declaration);
        let document = crate::model::DeviceTreeDocument::new(declaration.clone());
        let tree = self.tree.open(document).await.map_err(open_error)?;
        if let Some(child) = declaration.children.iter().find(|child| {
            child.enabled && child.driver.as_str() == data_model::device_tree::SIMULATION_DRIVER_ID
        }) && let Some(snapshot) = tree
            .snapshots()
            .into_iter()
            .find(|snapshot| snapshot.node_id == child.id)
            && !matches!(
                snapshot.state,
                data_model::device_tree::NodeState::Online { .. }
            )
        {
            let detail = snapshot.issue.map_or_else(
                || "simulation child is not online".into(),
                |issue| issue.detail,
            );
            let _ = tree.close().await;
            return Err(AcquisitionError::InvalidConfig(detail));
        }
        let mut resources = BTreeMap::new();
        for node in support::flatten(&declaration) {
            let points = node_points(&self.registry, &node)?;
            let (sample_sink, sample_rx) = mpsc::channel(SAMPLE_CHANNEL_CAPACITY);
            let samples = Arc::new(StateLane::new(SAMPLE_CACHE_POINTS, SAMPLE_CACHE_BYTES));
            spawn_sample_consumer(
                samples.clone(),
                sample_rx,
                self.observer.read().clone(),
                self.execution.clone(),
            );
            resources.insert(
                node.id,
                Arc::new(NodeResource {
                    samples,
                    sample_sink,
                }),
            );
            let _ = points;
        }
        let entry = Arc::new(NodeEntry {
            declaration: parking_lot::RwLock::new(declaration),
            tree,
            root_id: root_id.clone(),
            effective_node_id: effective,
            resources,
        });
        let protocol_link = {
            let declaration = entry.declaration.read();
            (declaration.driver.as_str() == "test-data")
                .then(|| support::protocol_link(&declaration))
                .flatten()
        };
        if let Some(link) = protocol_link
            && let Ok(session) = byte_session(&entry, &entry.effective_node_id)
            && let Some(stream) = session.byte_stream()
            && let Err(error) = stream.update_link(link, None)
        {
            let _ = entry.tree.close().await;
            return Err(AcquisitionError::Driver(error.to_string()));
        }
        let installed = {
            let _opening = self.opening.lock();
            if canceled.load(Ordering::Acquire) {
                false
            } else {
                self.nodes.write().insert(root_id.clone(), entry.clone());
                true
            }
        };
        if !installed {
            let _ = entry.tree.close().await;
            return Err(AcquisitionError::Closed);
        }
        entry.snapshot(&root_id)
    }
}

#[async_trait]
impl AcquisitionBackend for DeviceTreeAcquisition {
    fn set_observer(&self, observer: Arc<dyn PointBatchObserver>) {
        *self.observer.write() = Some(observer);
    }

    fn adapter_capabilities(&self) -> Vec<AdapterCapability> {
        self.registry.adapter_capabilities()
    }

    fn descriptors(&self, payload: &DriverPayload) -> AcquisitionResult<Vec<PointDescriptor>> {
        self.registry
            .point_descriptors(&DriverId::new(payload.driver_id.as_str()), &payload.payload)
            .map_err(|error| AcquisitionError::Driver(error.to_string()))
    }

    fn discover(&self, driver_id: &DriverId) -> AcquisitionResult<Vec<DiscoveredEndpoint>> {
        self.registry.discover(driver_id)
    }

    fn set_run_state(&self, state: AcquisitionRunState) -> u64 {
        self.execution.set(state)
    }

    fn validate(&self, payload: DriverPayload) -> AcquisitionResult<DriverPayload> {
        let driver_id = DriverId::new(payload.driver_id.as_str());
        let driver = self
            .registry
            .get(&driver_id)
            .ok_or_else(|| AcquisitionError::UnknownDriver(driver_id.to_string()))?;
        if payload.schema_version != driver.config_schema().schema_version {
            return Err(AcquisitionError::InvalidConfig(
                "driver schema version mismatch".into(),
            ));
        }
        driver
            .validate(&payload.payload, None)
            .map_err(|error| AcquisitionError::InvalidConfig(error.to_string()))?;
        driver
            .point_descriptors(&payload.payload)
            .map_err(|error| AcquisitionError::Driver(error.to_string()))?;
        Ok(payload)
    }

    async fn open_node(&self, declaration: NodeDecl) -> AcquisitionResult<NodeSnapshot> {
        validate_node(&declaration)?;
        let node_id = declaration.id.clone();
        let canceled = Arc::new(AtomicBool::new(false));
        {
            let mut opening = self.opening.lock();
            if self.nodes.read().contains_key(&node_id) || opening.contains_key(&node_id) {
                return Err(AcquisitionError::Busy);
            }
            opening.insert(
                node_id.clone(),
                OpeningEntry {
                    canceled: canceled.clone(),
                },
            );
        }
        let result = self.install(declaration, canceled).await;
        self.opening.lock().remove(&node_id);
        result
    }

    async fn close_node(&self, node_id: &NodeId) -> AcquisitionResult<()> {
        if let Some(opening) = self.opening.lock().get(node_id) {
            opening.canceled.store(true, Ordering::Release);
            return Ok(());
        }
        let root_id = match self.entry_for_node(node_id) {
            Ok(entry) => entry.root_id.clone(),
            Err(AcquisitionError::UnknownNode(_)) => return Ok(()),
            Err(error) => return Err(error),
        };
        if let Some(opening) = self.opening.lock().get(&root_id) {
            opening.canceled.store(true, Ordering::Release);
        }
        let Some(entry) = self.nodes.write().remove(&root_id) else {
            return Ok(());
        };
        entry
            .tree
            .close()
            .await
            .map_err(|errors| AcquisitionError::Driver(error_text(errors)))
    }

    async fn reconcile(&self, declarations: &[NodeDecl]) -> Vec<NodeId> {
        for (id, opening) in self.opening.lock().iter() {
            if !declarations.iter().any(|node| &node.id == id) {
                opening.canceled.store(true, Ordering::Release);
            }
        }
        let active: Vec<_> = self.nodes.read().values().cloned().collect();
        let mut closed = Vec::new();
        for entry in active {
            let next = declarations.iter().find(|node| node.id == entry.root_id);
            let current = entry.declaration.read().clone();
            if next == Some(&current) {
                continue;
            }
            if let Some(next) = next
                && only_simulation_changed(&current, next)
                && let Some(simulation) = simulation_config(next)
                && let Some(runtime) = entry.effective_runtime()
                && let Some(session) = runtime.source_session()
                && session.update_simulation(simulation).is_ok()
            {
                *entry.declaration.write() = next.clone();
                continue;
            }
            let id = entry.root_id.clone();
            if self.close_node(&id).await.is_ok() {
                closed.push(id);
            }
        }
        closed
    }

    fn snapshots(&self) -> Vec<NodeSnapshot> {
        self.nodes
            .read()
            .values()
            .flat_map(|entry| entry.tree.snapshots())
            .collect()
    }

    fn snapshot(&self, node_id: &NodeId) -> AcquisitionResult<NodeSnapshot> {
        self.entry_for_node(node_id)?.snapshot(node_id)
    }

    fn driver_manifests(&self) -> serde_json::Value {
        serde_json::to_value(self.registry.manifests()).unwrap_or(serde_json::Value::Null)
    }

    async fn read(&self, node_id: &NodeId, points: Vec<PointId>) -> AcquisitionResult<ReadResult> {
        let entry = self.entry_for_node(node_id)?;
        let runtime_id = Self::operation_node_id(&entry, node_id);
        let resource = entry.resource(node_id)?;
        let runtime = entry
            .runtime(&runtime_id)
            .ok_or(AcquisitionError::Unsupported("read"))?;
        let result = runtime
            .as_reader()
            .ok_or(AcquisitionError::Unsupported("read"))?
            .read(ReadRequest { points })
            .await?;
        if let Some(observer) = &*self.observer.read() {
            observer.observe(&result.batch);
        }
        for sample in &result.batch.payload.samples {
            let _ = resource.samples.push(sample.clone());
        }
        Ok(result)
    }

    async fn subscribe(
        &self,
        node_id: &NodeId,
        intent: SubscriptionIntent,
    ) -> AcquisitionResult<EffectiveSubscription> {
        let entry = self.entry_for_node(node_id)?;
        let runtime_id = Self::operation_node_id(&entry, node_id);
        let resource = entry.resource(node_id)?;
        let runtime = entry
            .runtime(&runtime_id)
            .ok_or(AcquisitionError::Unsupported("subscribe"))?;
        runtime
            .as_subscriber()
            .ok_or(AcquisitionError::Unsupported("subscribe"))?
            .subscribe(intent, resource.sample_sink.clone())
            .await
    }

    async fn write(
        &self,
        node_id: &NodeId,
        request: WriteRequest,
    ) -> AcquisitionResult<WriteResult> {
        let entry = self.entry_for_node(node_id)?;
        let runtime_id = Self::operation_node_id(&entry, node_id);
        let runtime = entry
            .runtime(&runtime_id)
            .ok_or(AcquisitionError::Unsupported("write"))?;
        runtime
            .as_writer()
            .ok_or(AcquisitionError::Unsupported("write"))?
            .write(request)
            .await
    }

    fn latest_samples(&self, node_id: &NodeId) -> AcquisitionResult<Vec<PointSample>> {
        Ok(self
            .entry_for_node(node_id)?
            .resource(node_id)?
            .samples
            .snapshot())
    }

    fn send(&self, node_id: &NodeId, bytes: &[u8]) -> Result<()> {
        let entry = self
            .entry_for_node(node_id)
            .map_err(|error| data_model::Error::Io(std::io::Error::other(error.to_string())))?;
        let runtime_id = Self::operation_node_id(&entry, node_id);
        let runtime = entry.runtime(&runtime_id).ok_or_else(|| {
            data_model::Error::Io(std::io::Error::other("node runtime unavailable"))
        })?;
        let sink = runtime.as_byte_sink().ok_or_else(|| {
            data_model::Error::Io(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "node does not accept byte writes",
            ))
        })?;
        let source_id = SourceId::new(runtime_id.to_string())
            .map_err(|error| data_model::Error::Io(std::io::Error::other(error.to_string())))?;
        let connection_epoch = runtime
            .state()
            .connection_epoch()
            .ok_or_else(|| data_model::Error::Io(std::io::Error::other("node is not online")))?;
        let envelope = FlowEnvelope {
            source_id,
            connection_epoch,
            first_sequence: 0,
            last_sequence: 0,
            observed_time_unix_ns: 0,
            direction: flow::Direction::Transmit,
            gap_before: None,
            payload: BytesChunk::complete(bytes.to_vec(), Framing::Stream),
        };
        sink.try_send_bytes(&envelope)
            .map_err(|error| data_model::Error::Io(std::io::Error::other(error.to_string())))
    }

    fn subscribe_bytes(
        &self,
        node_id: &NodeId,
    ) -> Option<tokio::sync::broadcast::Receiver<acquisition::ByteMessage>> {
        Some(support::subscribe_byte_messages(
            self.subscribe_flow(node_id)?,
        ))
    }

    fn subscribe_flow(&self, node_id: &NodeId) -> Option<FlowReceiver> {
        let entry = self.entry_for_node(node_id).ok()?;
        let runtime_id = Self::operation_node_id(&entry, node_id);
        Some(FlowReceiver::from_typed(
            entry
                .runtime(&runtime_id)?
                .as_byte_source()?
                .subscribe_bytes()
                .into_receiver(),
        ))
    }

    fn live_handle(&self, node_id: &NodeId) -> Option<LiveNodeHandle> {
        let entry = self.entry_for_node(node_id).ok()?;
        let runtime_id = Self::operation_node_id(&entry, node_id);
        Some(
            byte_session(&entry, &runtime_id)
                .ok()?
                .byte_stream()
                .expect("validated byte session")
                .live(node_id.as_str()),
        )
    }

    fn config(&self, node_id: &NodeId) -> Option<TransportConfig> {
        let entry = self.entry_for_node(node_id).ok()?;
        let runtime_id = Self::operation_node_id(&entry, node_id);
        Some(
            byte_session(&entry, &runtime_id)
                .ok()?
                .byte_stream()
                .expect("validated byte session")
                .config(),
        )
    }

    fn stats(&self, node_id: &NodeId) -> Option<TransportStats> {
        let entry = self.entry_for_node(node_id).ok()?;
        let runtime_id = Self::operation_node_id(&entry, node_id);
        Some(
            byte_session(&entry, &runtime_id)
                .ok()?
                .byte_stream()
                .expect("validated byte session")
                .stats(),
        )
    }

    fn state(&self, node_id: &NodeId) -> Option<ConnectionState> {
        let entry = self.entry_for_node(node_id).ok()?;
        let runtime_id = Self::operation_node_id(&entry, node_id);
        Some(connection_state(entry.runtime(&runtime_id)?.state()))
    }

    fn list_open(&self) -> Vec<NodeId> {
        self.nodes.read().keys().cloned().collect()
    }

    async fn close(&self, node_id: &NodeId) {
        let _ = self.close_node(node_id).await;
    }

    fn update_link(
        &self,
        node_id: &NodeId,
        link: TestDataLink,
        config: Option<TestDataConfig>,
    ) -> Result<()> {
        let entry = self
            .entry_for_node(node_id)
            .map_err(|error| data_model::Error::Io(std::io::Error::other(error.to_string())))?;
        let runtime_id = Self::operation_node_id(&entry, node_id);
        byte_session(&entry, &runtime_id)?
            .byte_stream()
            .expect("validated byte session")
            .update_link(link, config)?;
        Ok(())
    }
}
