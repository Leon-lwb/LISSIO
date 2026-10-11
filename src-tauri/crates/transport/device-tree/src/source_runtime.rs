//! 原生节点驱动共享的会话运行时与能力投影。

use crate::capability::{
    BrowseCapability, ByteSinkCapability, ByteSourceCapability, CapabilityMask, DiscoverCapability,
    InvokeCapability, RuntimeCapabilities, SimulationProviderCapability,
};
use crate::driver::{NodeRuntime, NodeStateEvent};
use crate::error::{CloseError, PortError};
use acquisition::{
    AddressSpaceDescriptor, PortDescriptor, ReadCapability, SourceFactory, SourceSession,
    SourceState, SubscribeCapability, SupervisorHandle, WriteCapability,
};
use async_trait::async_trait;
use data_model::device::DriverPayload;
use data_model::device_tree::{DriverId, NodeId, NodePath, NodeState};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tokio::sync::broadcast;

#[path = "source_ports.rs"]
mod ports;

enum SessionHandle {
    Direct(Arc<dyn SourceSession>),
    Supervised(Arc<SupervisorHandle>),
    Assembly(u64),
}

impl SessionHandle {
    fn current(&self) -> Option<Arc<dyn SourceSession>> {
        match self {
            Self::Direct(session) => Some(session.clone()),
            Self::Supervised(handle) => handle.current_session(),
            Self::Assembly(_) => None,
        }
    }
}

struct RuntimeInner {
    node_id: NodeId,
    node_path: NodePath,
    driver: DriverId,
    factory: Arc<dyn SourceFactory>,
    payload: DriverPayload,
    session: SessionHandle,
    ports: Vec<PortDescriptor>,
    address_spaces: Vec<AddressSpaceDescriptor>,
    discover: bool,
    browse: bool,
    declared: CapabilityMask,
    execution: acquisition::ExecutionGate,
    closed: AtomicBool,
}

impl SourceRuntime {
    /// 创建只提供仿真装配端口的父运行时，不打开真实来源会话。
    #[allow(clippy::too_many_arguments)]
    pub fn new_assembly(
        node_id: NodeId,
        node_path: NodePath,
        driver: DriverId,
        factory: Arc<dyn SourceFactory>,
        payload: DriverPayload,
        connection_epoch: u64,
        ports: Vec<PortDescriptor>,
        address_spaces: Vec<AddressSpaceDescriptor>,
        discover: bool,
        browse: bool,
        declared: CapabilityMask,
        execution: acquisition::ExecutionGate,
    ) -> Self {
        Self {
            inner: Arc::new(RuntimeInner {
                node_id,
                node_path,
                driver,
                factory,
                payload,
                session: SessionHandle::Assembly(connection_epoch),
                ports,
                address_spaces,
                discover,
                browse,
                declared,
                execution,
                closed: AtomicBool::new(false),
            }),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn new(
        node_id: NodeId,
        node_path: NodePath,
        driver: DriverId,
        factory: Arc<dyn SourceFactory>,
        payload: DriverPayload,
        session: Arc<dyn SourceSession>,
        ports: Vec<PortDescriptor>,
        address_spaces: Vec<AddressSpaceDescriptor>,
        discover: bool,
        browse: bool,
        declared: CapabilityMask,
        execution: acquisition::ExecutionGate,
    ) -> Self {
        Self {
            inner: Arc::new(RuntimeInner {
                node_id,
                node_path,
                driver,
                factory,
                payload,
                session: SessionHandle::Direct(session),
                ports,
                address_spaces,
                discover,
                browse,
                declared,
                execution,
                closed: AtomicBool::new(false),
            }),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn new_supervised(
        node_id: NodeId,
        node_path: NodePath,
        driver: DriverId,
        factory: Arc<dyn SourceFactory>,
        payload: DriverPayload,
        supervisor: Arc<SupervisorHandle>,
        ports: Vec<PortDescriptor>,
        address_spaces: Vec<AddressSpaceDescriptor>,
        discover: bool,
        browse: bool,
        declared: CapabilityMask,
        execution: acquisition::ExecutionGate,
        state_events: broadcast::Sender<NodeStateEvent>,
        initial_epoch: u64,
    ) -> Self {
        let mut states = supervisor.state();
        let event_identity = (node_id.clone(), node_path.clone());
        tokio::spawn(async move {
            let emit = |state: &SourceState| {
                let connection_epoch = match state {
                    SourceState::Online { connection_epoch } => *connection_epoch,
                    _ => initial_epoch,
                };
                let (error_kind, detail) = match state {
                    SourceState::Degraded { detail } => {
                        (Some("Source".to_string()), Some(detail.clone()))
                    }
                    _ => (None, None),
                };
                let _ = state_events.send(NodeStateEvent {
                    node_id: event_identity.0.clone(),
                    node_path: event_identity.1.clone(),
                    state: source_state(state.clone()),
                    connection_epoch,
                    error_kind,
                    detail,
                });
            };
            emit(&states.borrow().clone());
            while states.changed().await.is_ok() {
                emit(&states.borrow().clone());
            }
        });
        Self {
            inner: Arc::new(RuntimeInner {
                node_id,
                node_path,
                driver,
                factory,
                payload,
                session: SessionHandle::Supervised(supervisor),
                ports,
                address_spaces,
                discover,
                browse,
                declared,
                execution,
                closed: AtomicBool::new(false),
            }),
        }
    }
}

impl RuntimeInner {
    fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
    }

    fn session(&self) -> Option<Arc<dyn SourceSession>> {
        self.session.current()
    }

    fn state(&self) -> NodeState {
        if self.is_closed() {
            return NodeState::Closed;
        }
        if let SessionHandle::Supervised(handle) = &self.session {
            return source_state(handle.state().borrow().clone());
        }
        if let SessionHandle::Assembly(connection_epoch) = self.session {
            return NodeState::Online { connection_epoch };
        }
        self.session()
            .map_or(NodeState::Closed, |session| source_state(session.state()))
    }

    fn port_error(&self, operation: &'static str, detail: impl Into<String>) -> PortError {
        PortError {
            node_id: self.node_id.clone(),
            operation,
            detail: detail.into(),
        }
    }
}

pub struct SourceRuntime {
    inner: Arc<RuntimeInner>,
}

impl RuntimeCapabilities for SourceRuntime {
    fn capability_projection(&self) -> CapabilityMask {
        // 重连空窗期保持静态声明，当前会话存在时必须按真实句柄闭环。
        if self.inner.session().is_none()
            && matches!(
                self.inner.session,
                SessionHandle::Supervised(_) | SessionHandle::Assembly(_)
            )
        {
            return self.inner.declared;
        }
        crate::driver::runtime_capability_mask(self)
    }
}

#[async_trait]
impl NodeRuntime for SourceRuntime {
    fn node_id(&self) -> &NodeId {
        &self.inner.node_id
    }

    fn path(&self) -> &NodePath {
        &self.inner.node_path
    }

    fn driver(&self) -> &DriverId {
        &self.inner.driver
    }

    fn state(&self) -> NodeState {
        self.inner.state()
    }

    fn port_descriptors(&self) -> &[PortDescriptor] {
        &self.inner.ports
    }

    fn as_byte_source(&self) -> Option<&dyn ByteSourceCapability> {
        (self.inner.declared.byte_source
            && self
                .inner
                .session()
                .is_none_or(|session| session.byte_stream().is_some()))
        .then_some(self as &dyn ByteSourceCapability)
    }

    fn as_byte_sink(&self) -> Option<&dyn ByteSinkCapability> {
        (self.inner.declared.byte_sink
            && self
                .inner
                .session()
                .is_none_or(|session| session.byte_stream().is_some()))
        .then_some(self as &dyn ByteSinkCapability)
    }

    fn as_reader(&self) -> Option<&dyn ReadCapability> {
        (self.inner.declared.read
            && self
                .inner
                .session()
                .is_none_or(|session| session.reader().is_some()))
        .then_some(self as &dyn ReadCapability)
    }

    fn as_subscriber(&self) -> Option<&dyn SubscribeCapability> {
        (self.inner.declared.subscribe
            && self
                .inner
                .session()
                .is_none_or(|session| session.subscriber().is_some()))
        .then_some(self as &dyn SubscribeCapability)
    }

    fn as_writer(&self) -> Option<&dyn WriteCapability> {
        (self.inner.declared.write
            && self
                .inner
                .session()
                .is_none_or(|session| session.writer().is_some()))
        .then_some(self as &dyn WriteCapability)
    }

    fn as_invoker(&self) -> Option<&dyn InvokeCapability> {
        (self.inner.declared.invoke
            && self
                .inner
                .session()
                .is_none_or(|session| session.invoker().is_some()))
        .then_some(self as &dyn InvokeCapability)
    }

    fn as_browser(&self) -> Option<&dyn BrowseCapability> {
        self.inner.browse.then_some(self as &dyn BrowseCapability)
    }

    fn as_discoverer(&self) -> Option<&dyn DiscoverCapability> {
        self.inner
            .discover
            .then_some(self as &dyn DiscoverCapability)
    }

    fn as_simulation_provider(&self) -> Option<&dyn SimulationProviderCapability> {
        Some(self as &dyn SimulationProviderCapability)
    }

    fn source_session(&self) -> Option<Arc<dyn SourceSession>> {
        self.session()
    }

    fn source_session_capabilities(&self) -> Option<acquisition::SessionCapabilities> {
        self.session().map(|session| session.capabilities().clone())
    }

    async fn close(&self) -> Result<(), CloseError> {
        if self.inner.closed.swap(true, Ordering::AcqRel) {
            log::debug!("设备来源会话重复关闭: node={}", self.inner.node_id);
            return Ok(());
        }
        let started = Instant::now();
        let session_kind = match &self.inner.session {
            SessionHandle::Direct(_) => "direct",
            SessionHandle::Supervised(_) => "supervised",
            SessionHandle::Assembly(_) => "assembly",
        };
        log::info!(
            "设备来源会话关闭开始: node={}, kind={session_kind}",
            self.inner.node_id
        );
        let result = match &self.inner.session {
            SessionHandle::Direct(session) => session.close().await,
            SessionHandle::Supervised(handle) => handle.close().await,
            SessionHandle::Assembly(_) => Ok(()),
        };
        log::info!(
            "设备来源会话关闭完成: node={}, kind={session_kind}, elapsed_ms={}, result={}",
            self.inner.node_id,
            started.elapsed().as_millis(),
            if result.is_ok() { "ok" } else { "error" }
        );
        result.map_err(|error| CloseError {
            node_id: self.inner.node_id.clone(),
            detail: error.to_string(),
        })
    }
}

impl SourceRuntime {
    fn session(&self) -> Option<Arc<dyn SourceSession>> {
        self.inner.session()
    }
}

fn source_state(state: SourceState) -> NodeState {
    match state {
        SourceState::Disabled => NodeState::Disabled,
        SourceState::Validating => NodeState::Validating,
        SourceState::Connecting => NodeState::Connecting,
        SourceState::Online { connection_epoch } => NodeState::Online { connection_epoch },
        SourceState::Degraded { detail } => NodeState::Degraded { detail },
        SourceState::Backoff { attempt } => NodeState::Backoff { attempt },
        SourceState::Closing => NodeState::Closing,
        SourceState::Closed => NodeState::Closed,
    }
}
