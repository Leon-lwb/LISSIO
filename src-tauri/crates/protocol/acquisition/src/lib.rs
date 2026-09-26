//! Stateful orchestration contracts for typed acquisition sources.

pub mod backend;
mod capabilities;
pub mod handle;
mod point_simulation;
pub mod simulation;
pub use backend::{
    ByteMessage, ConnectionControl, FlowReceiver, FlowRecvError, FlowTryRecvError,
    LegacyFlowReceiver, TransportBackend, TransportConnection,
};
pub use handle::LiveNodeHandle;
mod lanes;
mod plane;
mod stores;
mod supervisor;
mod unconfigured;

pub use capabilities::{
    AdapterCapability, AddressRegion, AddressSpaceDescriptor, CAPABILITY_CONTRACT_VERSION,
    ConfigurationSchema, DiscoveredEndpoint, DisplaySemantics, EndpointDescriptor,
    EndpointDirection, PortDescriptor, PortDirection, ProtocolKind, RuntimeState, RuntimeStatus,
    TransportKind,
};
pub use lanes::{CommandLane, EventLane, EventLaneReceiver, LaneError, StateLane, StateLaneStats};
pub use plane::{AcquisitionBackend, AcquisitionRuntime};
pub use stores::{CommandLedger, CommandStatus, EventLog, PointStore};
pub use supervisor::{SourceState, SourceSupervisor, SupervisorHandle};
pub use unconfigured::UnconfiguredAcquisitionBackend;

use async_trait::async_trait;
use data_model::device::DriverPayload;
use data_model::device_tree::DriverId;
use flow::PayloadKind;
use points::{
    AcquisitionIntent, PointEnvelope, PointId, ReadRequest, ReadResult, WriteRequest, WriteResult,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::mpsc;

pub type AcquisitionResult<T> = Result<T, AcquisitionError>;

#[derive(Debug, thiserror::Error)]
pub enum AcquisitionError {
    #[error("invalid driver configuration: {0}")]
    InvalidConfig(String),
    #[error("driver mismatch: expected {expected}, got {actual}")]
    DriverMismatch { expected: String, actual: String },
    #[error("unknown driver: {0}")]
    UnknownDriver(String),
    #[error("unknown node: {0}")]
    UnknownNode(String),
    #[error("source is busy")]
    Busy,
    #[error("source is closed")]
    Closed,
    #[error("operation timed out")]
    Timeout,
    #[error("unsupported operation: {0}")]
    Unsupported(&'static str),
    #[error("driver operation failed: {0}")]
    Driver(String),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverManifest {
    pub id: DriverId,
    pub display_name: String,
    pub payload_kinds: BTreeSet<PayloadKind>,
    pub capabilities: CapabilitySet,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverSchema {
    pub schema_version: u32,
    pub json_schema: Value,
    pub ui_hints: Value,
}

// 能力位图按命名 bool 字段表达 — 每一位都是稳定的外部合同 (驱动清单/IPC),
// 收敛成位标志或嵌套分组会降低序列化可读性
#[allow(clippy::struct_excessive_bools)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilitySet {
    pub byte_source: bool,
    pub byte_sink: bool,
    pub discover: bool,
    pub browse: bool,
    pub read: bool,
    pub subscribe: bool,
    pub write: bool,
    pub method: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCapabilities {
    pub available: CapabilitySet,
    pub max_read_points: usize,
    pub max_write_points: usize,
    pub min_period_ms: Option<u64>,
    pub max_period_ms: Option<u64>,
    pub source_timestamps: bool,
    pub server_timestamps: bool,
    pub idempotent_writes: bool,
}

/// Context supplied by the composition root to an opened source.
#[derive(Clone)]
pub struct DriverContext {
    pub connection_epoch: u64,
    pub source_id: flow::SourceId,
    pub state_sink: SampleSink,
    pub event_sink: SampleSink,
    pub execution: ExecutionGate,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum AcquisitionRunState {
    #[default]
    Stopped,
    Running,
    Paused,
}

#[derive(Clone)]
pub struct ExecutionGate {
    state: tokio::sync::watch::Sender<AcquisitionRunState>,
    epoch: Arc<AtomicU64>,
}

impl ExecutionGate {
    pub fn new(state: AcquisitionRunState) -> Self {
        let (state, _) = tokio::sync::watch::channel(state);
        Self {
            state,
            epoch: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn set(&self, state: AcquisitionRunState) -> u64 {
        if *self.state.borrow() != state {
            self.epoch.fetch_add(1, Ordering::AcqRel);
            self.state.send_replace(state);
        }
        self.epoch()
    }

    pub fn state(&self) -> AcquisitionRunState {
        *self.state.borrow()
    }

    pub fn epoch(&self) -> u64 {
        self.epoch.load(Ordering::Acquire)
    }

    pub fn subscribe(&self) -> tokio::sync::watch::Receiver<AcquisitionRunState> {
        self.state.subscribe()
    }
}

pub type SampleSink = mpsc::Sender<PointEnvelope>;

/// Composition-root hook for routing typed point batches into product data
/// planes without coupling this protocol crate to desktop storage.
pub trait PointBatchObserver: Send + Sync {
    fn observe(&self, envelope: &PointEnvelope);
}

type OpenFuture = Pin<Box<dyn Future<Output = AcquisitionResult<Box<dyn SourceSession>>> + Send>>;

/// Opaque, already validated driver configuration.
pub struct ValidatedConfig {
    driver_id: DriverId,
    open: Option<Box<dyn FnOnce(DriverContext) -> OpenFuture + Send>>,
}

impl ValidatedConfig {
    pub fn new(
        driver_id: DriverId,
        open: impl FnOnce(DriverContext) -> OpenFuture + Send + 'static,
    ) -> Self {
        Self {
            driver_id,
            open: Some(Box::new(open)),
        }
    }

    pub const fn driver_id(&self) -> &DriverId {
        &self.driver_id
    }

    async fn open(mut self, context: DriverContext) -> AcquisitionResult<Box<dyn SourceSession>> {
        let open = self.open.take().ok_or(AcquisitionError::Closed)?;
        open(context).await
    }
}

#[async_trait]
pub trait SourceFactory: Send + Sync {
    async fn simulate(
        &self,
        input: &DriverPayload,
        config: &data_model::device::SimulationConfig,
        context: DriverContext,
    ) -> AcquisitionResult<Box<dyn SourceSession>> {
        simulation::validate(config)?;
        crate::point_simulation::open(self.point_descriptors(input)?, config.clone(), context)
    }
    fn manifest(&self) -> &DriverManifest;
    fn config_schema(&self) -> DriverSchema;
    fn adapter_capability(&self) -> AdapterCapability;
    fn discover(&self) -> AcquisitionResult<Vec<DiscoveredEndpoint>> {
        Ok(Vec::new())
    }
    fn validate(&self, input: &DriverPayload) -> AcquisitionResult<ValidatedConfig>;
    fn point_descriptors(
        &self,
        _input: &DriverPayload,
    ) -> AcquisitionResult<Vec<points::PointDescriptor>> {
        Ok(Vec::new())
    }

    async fn open(
        &self,
        config: ValidatedConfig,
        context: DriverContext,
    ) -> AcquisitionResult<Box<dyn SourceSession>> {
        let expected = &self.manifest().id;
        if config.driver_id() != expected {
            return Err(AcquisitionError::DriverMismatch {
                expected: expected.to_string(),
                actual: config.driver_id().to_string(),
            });
        }
        config.open(context).await
    }
}

#[async_trait]
pub trait SourceSession: Send + Sync {
    fn update_simulation(
        &self,
        _config: data_model::device::SimulationConfig,
    ) -> AcquisitionResult<()> {
        Err(AcquisitionError::Unsupported("simulation update"))
    }
    fn byte_stream(&self) -> Option<&handle::TransportHandle> {
        None
    }
    fn epoch(&self) -> u64;
    fn capabilities(&self) -> &SessionCapabilities;
    fn state(&self) -> SourceState {
        SourceState::Online {
            connection_epoch: self.epoch(),
        }
    }
    fn reader(&self) -> Option<&dyn ReadCapability> {
        None
    }
    fn subscriber(&self) -> Option<&dyn SubscribeCapability> {
        None
    }
    fn writer(&self) -> Option<&dyn WriteCapability> {
        None
    }
    fn invoker(&self) -> Option<&dyn InvokeCapability> {
        None
    }
    async fn stopped(&self) -> AcquisitionResult<()>;
    async fn close(&self) -> AcquisitionResult<()>;
}

#[async_trait]
pub trait ReadCapability: Send + Sync {
    async fn read(&self, request: ReadRequest) -> AcquisitionResult<ReadResult>;
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionIntent {
    pub points: Vec<PointId>,
    pub acquisition: AcquisitionIntent,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointRejection {
    pub point_id: PointId,
    pub reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveSubscription {
    pub accepted: Vec<PointId>,
    pub rejected: Vec<PointRejection>,
    pub effective_period_ms: Option<u64>,
    pub ordered: bool,
    pub may_have_gaps: bool,
}

#[async_trait]
pub trait SubscribeCapability: Send + Sync {
    async fn subscribe(
        &self,
        intent: SubscriptionIntent,
        sink: SampleSink,
    ) -> AcquisitionResult<EffectiveSubscription>;
}

#[async_trait]
pub trait WriteCapability: Send + Sync {
    async fn write(&self, request: WriteRequest) -> AcquisitionResult<WriteResult>;
}

#[async_trait]
pub trait InvokeCapability: Send + Sync {
    async fn invoke(&self, method: &str, args: Value) -> AcquisitionResult<Value>;
}

/// Returns an internal consistency error when declared capability bits and
/// session handles disagree. Adapters use this in their contract tests.
pub fn validate_capability_contract(session: &dyn SourceSession) -> AcquisitionResult<()> {
    let declared = session.capabilities().available;
    let checks = [
        ("read", declared.read, session.reader().is_some()),
        (
            "subscribe",
            declared.subscribe,
            session.subscriber().is_some(),
        ),
        ("write", declared.write, session.writer().is_some()),
        ("method", declared.method, session.invoker().is_some()),
    ];
    for (name, bit, handle) in checks {
        if bit != handle {
            return Err(AcquisitionError::Driver(format!(
                "capability {name} declaration does not match its handle"
            )));
        }
    }
    Ok(())
}
