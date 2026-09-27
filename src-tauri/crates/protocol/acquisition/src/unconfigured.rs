//! Composition-root placeholder that fails explicitly until production assembly installs a backend.

use crate::{
    AcquisitionBackend, AcquisitionResult, AcquisitionRunState, AdapterCapability, ByteMessage,
    DiscoveredEndpoint, EffectiveSubscription, FlowReceiver, LiveNodeHandle, PointBatchObserver,
    SubscriptionIntent,
};
use async_trait::async_trait;
use data_model::device::DriverPayload;
use data_model::device_tree::{DriverId, NodeDecl, NodeId, NodeSnapshot};
use data_model::{ConnectionState, TestDataConfig, TransportConfig, TransportStats};
use error::Result;
use points::{PointDescriptor, PointId, PointSample, ReadResult, WriteRequest, WriteResult};
use schema_types::TestDataLink;
use std::sync::Arc;
use tokio::sync::broadcast;

#[derive(Default)]
pub struct UnconfiguredAcquisitionBackend;

fn missing<T>() -> AcquisitionResult<T> {
    Err(crate::AcquisitionError::Driver(
        "acquisition backend is not assembled".into(),
    ))
}

#[async_trait]
impl AcquisitionBackend for UnconfiguredAcquisitionBackend {
    fn set_observer(&self, _observer: Arc<dyn PointBatchObserver>) {}
    fn adapter_capabilities(&self) -> Vec<AdapterCapability> {
        Vec::new()
    }
    fn descriptors(&self, _payload: &DriverPayload) -> AcquisitionResult<Vec<PointDescriptor>> {
        missing()
    }
    fn discover(&self, _driver_id: &DriverId) -> AcquisitionResult<Vec<DiscoveredEndpoint>> {
        missing()
    }
    fn set_run_state(&self, _state: AcquisitionRunState) -> u64 {
        0
    }
    fn validate(&self, _payload: DriverPayload) -> AcquisitionResult<DriverPayload> {
        missing()
    }
    async fn open_node(&self, _node: NodeDecl) -> AcquisitionResult<NodeSnapshot> {
        missing()
    }
    async fn close_node(&self, _node_id: &NodeId) -> AcquisitionResult<()> {
        Ok(())
    }
    async fn reconcile(&self, _nodes: &[NodeDecl]) -> Vec<NodeId> {
        Vec::new()
    }
    fn snapshots(&self) -> Vec<NodeSnapshot> {
        Vec::new()
    }
    fn snapshot(&self, node_id: &NodeId) -> AcquisitionResult<NodeSnapshot> {
        Err(crate::AcquisitionError::UnknownNode(node_id.to_string()))
    }
    async fn read(
        &self,
        _node_id: &NodeId,
        _points: Vec<PointId>,
    ) -> AcquisitionResult<ReadResult> {
        missing()
    }
    async fn subscribe(
        &self,
        _node_id: &NodeId,
        _intent: SubscriptionIntent,
    ) -> AcquisitionResult<EffectiveSubscription> {
        missing()
    }
    async fn write(
        &self,
        _node_id: &NodeId,
        _request: WriteRequest,
    ) -> AcquisitionResult<WriteResult> {
        missing()
    }
    fn latest_samples(&self, node_id: &NodeId) -> AcquisitionResult<Vec<PointSample>> {
        Err(crate::AcquisitionError::UnknownNode(node_id.to_string()))
    }
    fn send(&self, node_id: &NodeId, _bytes: &[u8]) -> Result<()> {
        Err(error::AppError::Io(std::io::Error::other(format!(
            "acquisition node is not assembled: {node_id}"
        ))))
    }
    fn subscribe_bytes(&self, _node_id: &NodeId) -> Option<broadcast::Receiver<ByteMessage>> {
        None
    }
    fn subscribe_flow(&self, _node_id: &NodeId) -> Option<FlowReceiver> {
        None
    }
    fn live_handle(&self, _node_id: &NodeId) -> Option<LiveNodeHandle> {
        None
    }
    fn config(&self, _node_id: &NodeId) -> Option<TransportConfig> {
        None
    }
    fn stats(&self, _node_id: &NodeId) -> Option<TransportStats> {
        None
    }
    fn state(&self, _node_id: &NodeId) -> Option<ConnectionState> {
        None
    }
    fn list_open(&self) -> Vec<NodeId> {
        Vec::new()
    }
    async fn close(&self, _node_id: &NodeId) {}
    fn update_link(
        &self,
        _node_id: &NodeId,
        _link: TestDataLink,
        _config: Option<TestDataConfig>,
    ) -> Result<()> {
        Err(error::AppError::Io(std::io::Error::other(
            "acquisition backend is not assembled",
        )))
    }
}
