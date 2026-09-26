//! 节点驱动、运行时、状态和打开上下文契约。

use crate::capability::RuntimeCapabilities;
use crate::capability::{
    BrowseCapability, ByteSinkCapability, ByteSourceCapability, CanFrameSinkCapability,
    CanFrameSourceCapability, CapabilityMask, DiscoverCapability, InvokeCapability,
    IsoTpRequestCapability, SimulationProviderCapability,
};
use crate::error::{CloseError, ConfigError, OpenError};
use crate::model::{ChildPolicy, DriverId, NodeId, NodePath, NodeRole, NodeState};
use acquisition::{
    AdapterCapability, ConfigurationSchema, DiscoveredEndpoint, PortDescriptor, ReadCapability,
    SessionCapabilities, SourceSession, SubscribeCapability, WriteCapability,
};
use async_trait::async_trait;
use points::PointDescriptor;
use serde_json::Value;
use std::any::Any;
use std::sync::Arc;
use tokio::sync::broadcast;

/// 已通过驱动语义校验的节点配置。
#[derive(Clone)]
pub struct ValidatedNodeConfig {
    driver_id: DriverId,
    schema_version: u32,
    config: Value,
    driver_state: Option<Arc<dyn Any + Send + Sync>>,
}

impl ValidatedNodeConfig {
    /// 创建驱动专属的已校验配置。
    pub const fn new(driver_id: DriverId, schema_version: u32, config: Value) -> Self {
        Self {
            driver_id,
            schema_version,
            config,
            driver_state: None,
        }
    }

    /// 附加驱动私有的已验证状态，供同一个驱动在 `open` 中取回。
    ///
    /// JSON 仍用于持久化和 IPC；强类型配置句柄只在 `validate` 到 `open`
    /// 之间传递，不进入序列化边界。
    #[must_use]
    pub fn with_driver_state<T: Any + Send + Sync + 'static>(mut self, state: T) -> Self {
        self.driver_state = Some(Arc::new(state));
        self
    }

    /// 取回驱动私有状态的共享句柄。
    pub fn driver_state<T: Any + Send + Sync + 'static>(&self) -> Option<Arc<T>> {
        self.driver_state
            .as_ref()
            .and_then(|state| Arc::downcast::<T>(state.clone()).ok())
    }

    /// 驱动身份。
    pub const fn driver_id(&self) -> &DriverId {
        &self.driver_id
    }

    /// 驱动配置 schema 版本。
    pub const fn schema_version(&self) -> u32 {
        self.schema_version
    }

    /// 驱动专属 JSON 配置。
    pub const fn config(&self) -> &Value {
        &self.config
    }

    /// 转移已校验配置的所有权。
    pub fn into_config(self) -> Value {
        self.config
    }
}

/// 状态事件。事件携带完整节点身份，避免接收侧依赖路径重算。
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeStateEvent {
    pub node_id: NodeId,
    pub node_path: NodePath,
    pub state: NodeState,
    pub connection_epoch: u64,
    pub error_kind: Option<String>,
    pub detail: Option<String>,
}

/// 打开节点时由组合根提供的上下文。
#[derive(Clone)]
pub struct NodeContext {
    node_id: NodeId,
    node_path: NodePath,
    connection_epoch: u64,
    state_events: broadcast::Sender<NodeStateEvent>,
    simulation_assembly: bool,
}

impl NodeContext {
    /// 创建节点上下文并注册状态事件端口。
    pub const fn new(
        node_id: NodeId,
        node_path: NodePath,
        connection_epoch: u64,
        state_events: broadcast::Sender<NodeStateEvent>,
    ) -> Self {
        Self {
            node_id,
            node_path,
            connection_epoch,
            state_events,
            simulation_assembly: false,
        }
    }

    /// 标记父节点只承担仿真装配，不打开真实来源会话。
    #[must_use]
    pub const fn with_simulation_assembly(mut self, simulation_assembly: bool) -> Self {
        self.simulation_assembly = simulation_assembly;
        self
    }

    /// 当前父节点是否只承担仿真装配。
    pub const fn simulation_assembly(&self) -> bool {
        self.simulation_assembly
    }

    /// 稳定节点身份。
    pub const fn node_id(&self) -> &NodeId {
        &self.node_id
    }

    /// 节点路径。
    pub const fn node_path(&self) -> &NodePath {
        &self.node_path
    }

    /// 当前连接 epoch。
    pub const fn connection_epoch(&self) -> u64 {
        self.connection_epoch
    }

    /// 节点状态事件端口。
    pub fn state_events(&self) -> broadcast::Sender<NodeStateEvent> {
        self.state_events.clone()
    }

    /// 发布节点状态事件。
    pub fn emit_state(&self, state: NodeState, error_kind: Option<String>, detail: Option<String>) {
        let _ = self.state_events.send(NodeStateEvent {
            node_id: self.node_id.clone(),
            node_path: self.node_path.clone(),
            state,
            connection_epoch: self.connection_epoch,
            error_kind,
            detail,
        });
    }
}

/// 节点行为实现。
#[async_trait]
pub trait NodeDriver: Send + Sync + 'static {
    fn id(&self) -> DriverId;
    fn role(&self) -> NodeRole;
    fn capabilities(&self) -> CapabilityMask;
    fn config_schema(&self) -> ConfigurationSchema;
    fn child_policy(&self) -> ChildPolicy;

    /// 返回驱动的产品能力目录。
    fn adapter_capability(&self) -> Option<AdapterCapability> {
        None
    }

    /// 返回驱动发现结果，未实现发现的驱动返回空目录。
    fn discover(&self) -> acquisition::AcquisitionResult<Vec<DiscoveredEndpoint>> {
        Ok(Vec::new())
    }

    /// 返回配置对应的点位描述。
    fn point_descriptors(
        &self,
        _config: &Value,
    ) -> acquisition::AcquisitionResult<Vec<PointDescriptor>> {
        Ok(Vec::new())
    }

    /// 返回节点运行时应暴露的能力。默认与静态声明一致。
    fn runtime_capabilities(
        &self,
        _config: &Value,
        _parent: Option<&crate::capability::ParentContract>,
    ) -> CapabilityMask {
        self.capabilities()
    }

    /// 返回节点稳定端口目录。端口 id 必须与运行时投影保持一致。
    fn port_descriptors(&self, _config: &Value) -> Vec<PortDescriptor> {
        Vec::new()
    }

    fn validate(
        &self,
        config: &Value,
        parent: Option<&crate::capability::ParentContract>,
    ) -> Result<ValidatedNodeConfig, ConfigError>;

    async fn open(
        &self,
        config: ValidatedNodeConfig,
        parent: Option<Arc<dyn NodeRuntime>>,
        context: NodeContext,
    ) -> Result<Arc<dyn NodeRuntime>, OpenError>;
}

/// 节点当前行为和 typed port 投影。
#[async_trait]
pub trait NodeRuntime: RuntimeCapabilities + Send + Sync + 'static {
    fn node_id(&self) -> &NodeId;
    fn path(&self) -> &NodePath;
    fn driver(&self) -> &DriverId;
    fn state(&self) -> NodeState;
    fn port_descriptors(&self) -> &[PortDescriptor];

    fn as_byte_source(&self) -> Option<&dyn ByteSourceCapability> {
        None
    }

    fn as_byte_sink(&self) -> Option<&dyn ByteSinkCapability> {
        None
    }

    fn as_can_frame_source(&self) -> Option<&dyn CanFrameSourceCapability> {
        None
    }

    fn as_can_frame_sink(&self) -> Option<&dyn CanFrameSinkCapability> {
        None
    }

    fn as_isotp_request(&self) -> Option<&dyn IsoTpRequestCapability> {
        None
    }

    fn as_reader(&self) -> Option<&dyn ReadCapability> {
        None
    }

    fn as_subscriber(&self) -> Option<&dyn SubscribeCapability> {
        None
    }

    fn as_writer(&self) -> Option<&dyn WriteCapability> {
        None
    }

    fn as_invoker(&self) -> Option<&dyn InvokeCapability> {
        None
    }

    fn as_browser(&self) -> Option<&dyn BrowseCapability> {
        None
    }

    fn as_discoverer(&self) -> Option<&dyn DiscoverCapability> {
        None
    }

    fn as_simulation_provider(&self) -> Option<&dyn SimulationProviderCapability> {
        None
    }

    /// 当前底层来源会话，用于字节元数据查询。
    fn source_session(&self) -> Option<Arc<dyn SourceSession>> {
        None
    }

    /// 当前底层来源会话的能力限制。
    fn source_session_capabilities(&self) -> Option<SessionCapabilities> {
        None
    }

    async fn close(&self) -> Result<(), CloseError>;
}

/// 由驱动运行时投影派生完整能力掩码。
pub fn runtime_capability_mask(runtime: &dyn NodeRuntime) -> CapabilityMask {
    CapabilityMask {
        byte_source: runtime.as_byte_source().is_some(),
        byte_sink: runtime.as_byte_sink().is_some(),
        can_frame_source: runtime.as_can_frame_source().is_some(),
        can_frame_sink: runtime.as_can_frame_sink().is_some(),
        read: runtime.as_reader().is_some(),
        subscribe: runtime.as_subscriber().is_some(),
        write: runtime.as_writer().is_some(),
        invoke: runtime.as_invoker().is_some(),
        browse: runtime.as_browser().is_some(),
        discover: runtime.as_discoverer().is_some(),
    }
}

/// 驱动合同 fixture 的父运行时输入。
pub struct ParentFixture {
    pub role: NodeRole,
    pub runtime: Arc<dyn NodeRuntime>,
}

/// 只用于驱动合同测试的节点 fixture。
pub struct DriverContractFixture {
    pub node_id: NodeId,
    pub driver_id: DriverId,
    pub schema_version: u32,
    pub config: Value,
    pub parent: Option<ParentFixture>,
}

impl DriverContractFixture {
    /// 创建默认启用的合同 fixture。
    pub fn new(
        node_id: impl AsRef<str>,
        driver_id: DriverId,
        schema_version: u32,
        config: Value,
    ) -> Result<Self, ConfigError> {
        Ok(Self {
            node_id: NodeId::new(node_id)?,
            driver_id,
            schema_version,
            config,
            parent: None,
        })
    }
}
