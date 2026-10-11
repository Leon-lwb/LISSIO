//! Native device-tree driver for Siemens S7.

use crate::factory::S7Factory;
use acquisition::{
    AdapterCapability, AddressSpaceDescriptor, DiscoveredEndpoint, ExecutionGate, PortDescriptor,
    SourceFactory, SourceSupervisor,
};
use async_trait::async_trait;
use data_model::ConfigurationSchema;
use data_model::device_tree::{ChildPolicy, DriverId, NodeId, NodeRole};
use device_tree::{
    Capability, CapabilityMask, ConfigError, NodeContext, NodeDriver, NodeRuntime, OpenError,
    ParentContract, SourceRuntimeBuilder, SourceValidationState, ValidatedNodeConfig,
    source_capability_mask, source_child_policy, source_payload,
};
use points::PointDescriptor;
use serde_json::Value;
use std::sync::Arc;

pub struct S7Driver {
    factory: Arc<S7Factory>,
    execution: ExecutionGate,
    capabilities: CapabilityMask,
    schema: ConfigurationSchema,
    ports: Vec<PortDescriptor>,
    address_spaces: Vec<AddressSpaceDescriptor>,
}

impl S7Driver {
    pub fn new(execution: ExecutionGate) -> Self {
        let factory = Arc::new(S7Factory::default());
        let adapter = factory.adapter_capability();
        let schema = factory.config_schema();
        Self {
            factory: factory.clone(),
            execution,
            capabilities: source_capability_mask(factory.manifest().capabilities),
            schema: ConfigurationSchema {
                schema_version: schema.schema_version,
                json_schema: schema.json_schema,
                ui_hints: schema.ui_hints,
            },
            ports: adapter
                .endpoints
                .iter()
                .flat_map(|endpoint| endpoint.ports.iter().cloned())
                .collect(),
            address_spaces: adapter
                .endpoints
                .iter()
                .flat_map(|endpoint| endpoint.ports.iter())
                .filter_map(|port| port.address_space.clone())
                .collect(),
        }
    }

    fn payload(&self, config: &Value) -> data_model::device::DriverPayload {
        source_payload(crate::DRIVER_ID, self.schema.schema_version, config)
    }

    fn config_error(detail: impl Into<String>) -> ConfigError {
        ConfigError::InvalidDriverConfig {
            node_id: NodeId::new(crate::DRIVER_ID).expect("constant driver id"),
            detail: detail.into(),
        }
    }
}

#[async_trait]
impl NodeDriver for S7Driver {
    fn id(&self) -> DriverId {
        DriverId::new(crate::DRIVER_ID)
    }

    fn role(&self) -> NodeRole {
        NodeRole::Protocol
    }

    fn capabilities(&self) -> CapabilityMask {
        self.capabilities
    }

    fn config_schema(&self) -> ConfigurationSchema {
        self.schema.clone()
    }

    fn child_policy(&self) -> ChildPolicy {
        source_child_policy(self.role())
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
        parent: Option<&ParentContract>,
    ) -> Result<ValidatedNodeConfig, ConfigError> {
        if let Some(parent) = parent {
            parent.require(
                &NodeId::new(crate::DRIVER_ID).expect("constant driver id"),
                &[Capability::ByteSource, Capability::ByteSink],
            )?;
        }
        let validated = self
            .factory
            .validate(&self.payload(config))
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
        let builder = SourceRuntimeBuilder::new(
            self.factory.clone(),
            self.payload(config.config()),
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
