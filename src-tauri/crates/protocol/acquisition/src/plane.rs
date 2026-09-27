//! 可替换的生产采集平面合同和稳定产品门面。

use crate::{
    AcquisitionResult, AcquisitionRunState, AdapterCapability, ByteMessage, DiscoveredEndpoint,
    EffectiveSubscription, FlowReceiver, LiveNodeHandle, PointBatchObserver, SubscriptionIntent,
};
use async_trait::async_trait;
use data_model::device::DriverPayload;
use data_model::device_tree::{DriverId, NodeDecl, NodeId, NodeSnapshot};
use data_model::{ConnectionState, TestDataConfig, TransportConfig, TransportStats};
use error::Result;
use points::{PointDescriptor, PointId, PointSample, ReadResult, WriteRequest, WriteResult};
use schema_types::TestDataLink;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::broadcast;

/// 产品采集运行时的后端端口。
#[async_trait]
pub trait AcquisitionBackend: Send + Sync {
    fn set_observer(&self, observer: Arc<dyn PointBatchObserver>);
    fn adapter_capabilities(&self) -> Vec<AdapterCapability>;
    fn descriptors(&self, payload: &DriverPayload) -> AcquisitionResult<Vec<PointDescriptor>>;
    fn discover(&self, driver_id: &DriverId) -> AcquisitionResult<Vec<DiscoveredEndpoint>>;
    fn set_run_state(&self, state: AcquisitionRunState) -> u64;
    fn validate(&self, payload: DriverPayload) -> AcquisitionResult<DriverPayload>;

    async fn open_node(&self, node: NodeDecl) -> AcquisitionResult<NodeSnapshot>;
    async fn close_node(&self, node_id: &NodeId) -> AcquisitionResult<()>;
    async fn reconcile(&self, nodes: &[NodeDecl]) -> Vec<NodeId>;

    fn snapshots(&self) -> Vec<NodeSnapshot>;
    fn snapshot(&self, node_id: &NodeId) -> AcquisitionResult<NodeSnapshot>;

    fn device_tree_nodes(&self) -> Value {
        serde_json::to_value(self.snapshots()).unwrap_or(Value::Null)
    }

    fn driver_manifests(&self) -> Value {
        serde_json::to_value(self.adapter_capabilities()).unwrap_or(Value::Null)
    }

    async fn read(&self, node_id: &NodeId, points: Vec<PointId>) -> AcquisitionResult<ReadResult>;
    async fn subscribe(
        &self,
        node_id: &NodeId,
        intent: SubscriptionIntent,
    ) -> AcquisitionResult<EffectiveSubscription>;
    async fn write(
        &self,
        node_id: &NodeId,
        request: WriteRequest,
    ) -> AcquisitionResult<WriteResult>;
    fn latest_samples(&self, node_id: &NodeId) -> AcquisitionResult<Vec<PointSample>>;

    fn send(&self, node_id: &NodeId, bytes: &[u8]) -> Result<()>;
    fn subscribe_bytes(&self, node_id: &NodeId) -> Option<broadcast::Receiver<ByteMessage>>;
    fn subscribe_flow(&self, node_id: &NodeId) -> Option<FlowReceiver>;
    fn live_handle(&self, node_id: &NodeId) -> Option<LiveNodeHandle>;
    fn config(&self, node_id: &NodeId) -> Option<TransportConfig>;
    fn stats(&self, node_id: &NodeId) -> Option<TransportStats>;
    fn state(&self, node_id: &NodeId) -> Option<ConnectionState>;
    fn list_open(&self) -> Vec<NodeId>;
    async fn close(&self, node_id: &NodeId);
    fn update_link(
        &self,
        node_id: &NodeId,
        link: TestDataLink,
        config: Option<TestDataConfig>,
    ) -> Result<()>;
}

/// 稳定产品门面。生产装配注入设备树后端，不暴露后端私有状态。
pub struct AcquisitionRuntime {
    backend: Arc<dyn AcquisitionBackend>,
}

impl Default for AcquisitionRuntime {
    fn default() -> Self {
        Self::new(Arc::new(crate::UnconfiguredAcquisitionBackend))
    }
}

impl AcquisitionRuntime {
    pub fn new(backend: Arc<dyn AcquisitionBackend>) -> Self {
        Self { backend }
    }

    pub const fn backend(&self) -> &Arc<dyn AcquisitionBackend> {
        &self.backend
    }

    pub fn set_observer(&self, observer: Arc<dyn PointBatchObserver>) {
        self.backend.set_observer(observer);
    }

    pub fn adapter_capabilities(&self) -> Vec<AdapterCapability> {
        self.backend.adapter_capabilities()
    }

    pub fn descriptors(&self, payload: &DriverPayload) -> AcquisitionResult<Vec<PointDescriptor>> {
        self.backend.descriptors(payload)
    }

    pub fn discover(&self, driver_id: &DriverId) -> AcquisitionResult<Vec<DiscoveredEndpoint>> {
        self.backend.discover(driver_id)
    }

    pub fn set_run_state(&self, state: AcquisitionRunState) -> u64 {
        self.backend.set_run_state(state)
    }

    pub fn validate(&self, payload: DriverPayload) -> AcquisitionResult<DriverPayload> {
        self.backend.validate(payload)
    }

    pub async fn open_node(&self, node: NodeDecl) -> AcquisitionResult<NodeSnapshot> {
        self.backend.open_node(node).await
    }

    pub async fn close_node(&self, node_id: &NodeId) -> AcquisitionResult<()> {
        self.backend.close_node(node_id).await
    }

    pub async fn reconcile(&self, nodes: &[NodeDecl]) -> Vec<NodeId> {
        self.backend.reconcile(nodes).await
    }

    pub fn snapshots(&self) -> Vec<NodeSnapshot> {
        self.backend.snapshots()
    }

    pub fn snapshot(&self, node_id: &NodeId) -> AcquisitionResult<NodeSnapshot> {
        self.backend.snapshot(node_id)
    }

    pub fn device_tree_nodes(&self) -> Value {
        self.backend.device_tree_nodes()
    }

    pub fn driver_manifests(&self) -> Value {
        self.backend.driver_manifests()
    }

    pub async fn read(
        &self,
        node_id: &NodeId,
        points: Vec<PointId>,
    ) -> AcquisitionResult<ReadResult> {
        self.backend.read(node_id, points).await
    }

    pub async fn subscribe(
        &self,
        node_id: &NodeId,
        intent: SubscriptionIntent,
    ) -> AcquisitionResult<EffectiveSubscription> {
        self.backend.subscribe(node_id, intent).await
    }

    pub async fn write(
        &self,
        node_id: &NodeId,
        request: WriteRequest,
    ) -> AcquisitionResult<WriteResult> {
        self.backend.write(node_id, request).await
    }

    pub fn latest_samples(&self, node_id: &NodeId) -> AcquisitionResult<Vec<PointSample>> {
        self.backend.latest_samples(node_id)
    }

    pub fn send(&self, node_id: &NodeId, bytes: &[u8]) -> Result<()> {
        self.backend.send(node_id, bytes)
    }

    pub fn subscribe_bytes(&self, node_id: &NodeId) -> Option<broadcast::Receiver<ByteMessage>> {
        self.backend.subscribe_bytes(node_id)
    }

    pub fn subscribe_flow(&self, node_id: &NodeId) -> Option<FlowReceiver> {
        self.backend.subscribe_flow(node_id)
    }

    pub fn live_handle(&self, node_id: &NodeId) -> Option<LiveNodeHandle> {
        self.backend.live_handle(node_id)
    }

    pub fn config(&self, node_id: &NodeId) -> Option<TransportConfig> {
        self.backend.config(node_id)
    }

    pub fn stats(&self, node_id: &NodeId) -> Option<TransportStats> {
        self.backend.stats(node_id)
    }

    pub fn state(&self, node_id: &NodeId) -> Option<ConnectionState> {
        self.backend.state(node_id)
    }

    pub fn list_open(&self) -> Vec<NodeId> {
        self.backend.list_open()
    }

    pub async fn close(&self, node_id: &NodeId) {
        self.backend.close(node_id).await;
    }

    pub fn update_link(
        &self,
        node_id: &NodeId,
        link: TestDataLink,
        config: Option<TestDataConfig>,
    ) -> Result<()> {
        self.backend.update_link(node_id, link, config)
    }
}
