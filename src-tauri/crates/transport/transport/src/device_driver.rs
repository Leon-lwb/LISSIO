//! Native device-tree driver for byte transport backends.

use crate::device_factory::ByteDeviceFactory;
use acquisition::{
    AdapterCapability, DiscoveredEndpoint, ExecutionGate, PortDescriptor, SourceFactory,
    SourceSupervisor,
};
use async_trait::async_trait;
use data_model::ConfigurationSchema;
use data_model::TransportConfig;
use data_model::device_tree::NodeId;
use device_tree::{
    CapabilityMask, ChildPolicy, ConfigError, DriverId, NodeContext, NodeDriver, NodeRole,
    NodeRuntime, OpenError, ParentContract, SourceRuntimeBuilder, SourceValidationState,
    ValidatedNodeConfig, source_capability_mask, source_child_policy, source_payload,
};
use points::PointDescriptor;
use serde_json::Value;
use std::sync::Arc;

/// Native `NodeDriver` for a byte transport backend.
pub struct ByteDeviceDriver {
    factory: Arc<ByteDeviceFactory>,
    role: NodeRole,
    capabilities: CapabilityMask,
    schema: ConfigurationSchema,
    ports: Vec<PortDescriptor>,
    address_spaces: Vec<acquisition::AddressSpaceDescriptor>,
    execution: ExecutionGate,
}

impl ByteDeviceDriver {
    pub fn new(
        id: &str,
        name: &str,
        defaults: TransportConfig,
        backend: Arc<dyn acquisition::TransportBackend>,
        role: NodeRole,
        execution: ExecutionGate,
    ) -> Self {
        let factory = Arc::new(ByteDeviceFactory::new(id, name, defaults, backend));
        let manifest_capabilities = factory.manifest().capabilities;
        let adapter = factory.adapter_capability();
        let ports = adapter
            .endpoints
            .iter()
            .flat_map(|endpoint| endpoint.ports.iter().cloned())
            .collect();
        let address_spaces = adapter
            .endpoints
            .iter()
            .flat_map(|endpoint| endpoint.ports.iter())
            .filter_map(|port| port.address_space.clone())
            .collect();
        Self {
            factory: factory.clone(),
            role,
            capabilities: source_capability_mask(manifest_capabilities),
            schema: ConfigurationSchema {
                schema_version: factory.config_schema().schema_version,
                json_schema: factory.config_schema().json_schema,
                ui_hints: factory.config_schema().ui_hints,
            },
            ports,
            address_spaces,
            execution,
        }
    }

    fn payload(&self, config: &Value) -> data_model::device::DriverPayload {
        source_payload(self.id().as_str(), self.schema.schema_version, config)
    }

    fn config_error(detail: impl Into<String>) -> ConfigError {
        ConfigError::InvalidDriverConfig {
            node_id: NodeId::new("byte-device").expect("constant node id"),
            detail: detail.into(),
        }
    }
}

#[async_trait]
impl NodeDriver for ByteDeviceDriver {
    fn id(&self) -> DriverId {
        DriverId::new(self.factory.manifest().id.as_str())
    }

    fn role(&self) -> NodeRole {
        self.role
    }

    fn capabilities(&self) -> CapabilityMask {
        self.capabilities
    }

    fn config_schema(&self) -> ConfigurationSchema {
        self.schema.clone()
    }

    fn display_name(&self) -> String {
        self.factory.manifest().display_name.clone()
    }

    /// 创建默认配置 — 驱动负载, 即 `TransportConfig` 的 `params` 子对象 (扁平参数)。
    /// 后端工厂在 prepare 时按 driver 选择, 不从前端白名单查表。
    ///
    /// 文档里的 `NodeDecl.config`、面板消费的 `config_schema` 属性名,
    /// 以及 [`ByteDeviceFactory::config`] 收到的 payload 是同一层 (扁平参数)。
    /// 这里若下发 `{ kind, params }` 信封, 属性面板按 schema 属性名读不到任何字段
    /// (整页显示空值/首选项), 且 `validate` 因缺 `port_name`/`baud_rate` 等字段
    /// 失败 —— 设备无法连接。
    fn default_config(&self, _node_id: &str) -> Option<Value> {
        let envelope = serde_json::to_value(self.factory.defaults()).ok()?;
        envelope.get("params").cloned()
    }

    fn child_policy(&self) -> ChildPolicy {
        source_child_policy(self.role)
    }

    fn adapter_capability(&self) -> Option<AdapterCapability> {
        Some(self.factory.adapter_capability())
    }

    fn discover(&self) -> acquisition::AcquisitionResult<Vec<DiscoveredEndpoint>> {
        self.factory.discover()
    }

    fn point_descriptors(
        &self,
        config: &Value,
    ) -> acquisition::AcquisitionResult<Vec<PointDescriptor>> {
        self.factory.point_descriptors(&self.payload(config))
    }

    fn port_descriptors(&self, _config: &Value) -> Vec<PortDescriptor> {
        self.ports.clone()
    }

    fn validate(
        &self,
        config: &Value,
        _parent: Option<&ParentContract>,
    ) -> Result<ValidatedNodeConfig, ConfigError> {
        let payload = self.payload(config);
        let validated = self
            .factory
            .validate(&payload)
            .map_err(|error| Self::config_error(error.to_string()))?;
        Ok(
            ValidatedNodeConfig::new(self.id(), self.schema.schema_version, config.clone())
                .with_driver_state(SourceValidationState::new(validated)),
        )
    }

    async fn open(
        &self,
        config: ValidatedNodeConfig,
        _parent: Option<Arc<dyn NodeRuntime>>,
        context: NodeContext,
    ) -> Result<Arc<dyn NodeRuntime>, OpenError> {
        let validated = config
            .driver_state::<SourceValidationState>()
            .and_then(|state| state.take());
        let payload = self.payload(config.config());
        let builder = SourceRuntimeBuilder::new(
            self.factory.clone(),
            payload,
            self.ports.clone(),
            self.address_spaces.clone(),
            self.capabilities.discover,
            self.capabilities.browse,
            self.capabilities,
            self.execution.clone(),
        );
        builder
            .open(validated, Some(SourceSupervisor::default()), &context)
            .await
    }
}
