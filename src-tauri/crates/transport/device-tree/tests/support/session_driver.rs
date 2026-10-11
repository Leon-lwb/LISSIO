//! 用固定会话工厂验证生产共享运行时的数据语义。
use super::TestFactory;
use acquisition::{ExecutionGate, PortDescriptor, SourceFactory, SourceSupervisor};
use async_trait::async_trait;
use data_model::ConfigurationSchema;
use data_model::device_tree::{ChildPolicy, DriverId, NodeId, NodeRole};
use device_tree::{
    CapabilityMask, ConfigError, NodeContext, NodeDriver, NodeRuntime, OpenError, ParentContract,
    SourceRuntimeBuilder, SourceValidationState, ValidatedNodeConfig, source_capability_mask,
    source_child_policy, source_payload,
};
use serde_json::Value;
use std::sync::Arc;

pub struct SessionDriver {
    factory: Arc<TestFactory>,
    role: NodeRole,
    supervisor: Option<SourceSupervisor>,
}

impl SessionDriver {
    pub const fn new(factory: Arc<TestFactory>, role: NodeRole) -> Self {
        Self {
            factory,
            role,
            supervisor: None,
        }
    }

    pub const fn with_supervisor(mut self, supervisor: SourceSupervisor) -> Self {
        self.supervisor = Some(supervisor);
        self
    }
}

#[async_trait]
impl NodeDriver for SessionDriver {
    fn id(&self) -> DriverId {
        self.factory.manifest().id.clone()
    }
    fn role(&self) -> NodeRole {
        self.role
    }
    fn capabilities(&self) -> CapabilityMask {
        source_capability_mask(self.factory.manifest().capabilities)
    }
    fn config_schema(&self) -> ConfigurationSchema {
        let schema = self.factory.config_schema();
        ConfigurationSchema {
            schema_version: schema.schema_version,
            json_schema: schema.json_schema,
            ui_hints: schema.ui_hints,
        }
    }
    fn child_policy(&self) -> ChildPolicy {
        source_child_policy(self.role)
    }
    fn adapter_capability(&self) -> Option<acquisition::AdapterCapability> {
        Some(self.factory.adapter_capability())
    }
    fn point_descriptors(
        &self,
        config: &Value,
    ) -> acquisition::AcquisitionResult<Vec<points::PointDescriptor>> {
        self.factory.point_descriptors(&source_payload(
            self.id().as_str(),
            self.config_schema().schema_version,
            config,
        ))
    }
    fn port_descriptors(&self, _config: &Value) -> Vec<PortDescriptor> {
        self.factory
            .adapter_capability()
            .endpoints
            .into_iter()
            .flat_map(|endpoint| endpoint.ports)
            .collect()
    }
    fn validate(
        &self,
        config: &Value,
        _parent: Option<&ParentContract>,
    ) -> Result<ValidatedNodeConfig, ConfigError> {
        let payload = source_payload(
            self.id().as_str(),
            self.config_schema().schema_version,
            config,
        );
        let error = |error: acquisition::AcquisitionError| ConfigError::InvalidDriverConfig {
            node_id: NodeId::new("fixture").unwrap(),
            detail: error.to_string(),
        };
        let validated = self.factory.validate(&payload).map_err(error)?;
        self.point_descriptors(config).map_err(error)?;
        Ok(
            ValidatedNodeConfig::new(self.id(), payload.schema_version, config.clone())
                .with_driver_state(SourceValidationState::new(validated)),
        )
    }
    async fn open(
        &self,
        config: ValidatedNodeConfig,
        _parent: Option<Arc<dyn NodeRuntime>>,
        context: NodeContext,
    ) -> Result<Arc<dyn NodeRuntime>, OpenError> {
        let ports = self.port_descriptors(config.config());
        let address_spaces = ports
            .iter()
            .filter_map(|port| port.address_space.clone())
            .collect();
        let mask = self.capabilities();
        SourceRuntimeBuilder::new(
            self.factory.clone(),
            source_payload(self.id().as_str(), config.schema_version(), config.config()),
            ports,
            address_spaces,
            mask.discover,
            mask.browse,
            mask,
            ExecutionGate::new(acquisition::AcquisitionRunState::Running),
        )
        .open(
            config
                .driver_state::<SourceValidationState>()
                .and_then(|state| state.take()),
            self.supervisor,
            &context,
        )
        .await
    }
}
