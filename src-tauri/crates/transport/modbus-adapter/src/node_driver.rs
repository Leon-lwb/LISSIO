//! Native device-tree drivers for Modbus TCP and RTU.

use crate::factory::{ModbusFactory, ModbusRtuFactory};
use acquisition::{
    AdapterCapability, AddressSpaceDescriptor, ConfigurationSchema, DiscoveredEndpoint,
    ExecutionGate, PortDescriptor, SourceFactory, SourceSupervisor,
};
use async_trait::async_trait;
use device_tree::{
    Capability, CapabilityMask, ChildPolicy, ConfigError, DriverId, NodeContext, NodeDriver,
    NodeId, NodeRole, NodeRuntime, OpenError, ParentContract, SourceRuntimeBuilder,
    SourceValidationState, ValidatedNodeConfig, source_capability_mask, source_child_policy,
    source_payload,
};
use points::PointDescriptor;
use serde_json::Value;
use std::sync::Arc;

macro_rules! source_driver {
    ($name:ident, $factory:ty, $id:expr, $role:expr) => {
        pub struct $name {
            factory: Arc<$factory>,
            execution: ExecutionGate,
            capabilities: CapabilityMask,
            schema: ConfigurationSchema,
            ports: Vec<PortDescriptor>,
            address_spaces: Vec<AddressSpaceDescriptor>,
        }

        impl $name {
            pub fn new(execution: ExecutionGate) -> Self {
                let factory = Arc::new(<$factory>::default());
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
                        .flat_map(|e| e.ports.iter().cloned())
                        .collect(),
                    address_spaces: adapter
                        .endpoints
                        .iter()
                        .flat_map(|e| e.ports.iter())
                        .filter_map(|p| p.address_space.clone())
                        .collect(),
                }
            }

            fn payload(&self, config: &Value) -> data_model::device::DriverPayload {
                source_payload($id, self.schema.schema_version, config)
            }

            fn config_error(detail: impl Into<String>) -> ConfigError {
                ConfigError::InvalidDriverConfig {
                    node_id: NodeId::new($id).expect("constant driver id"),
                    detail: detail.into(),
                }
            }
        }

        #[async_trait]
        impl NodeDriver for $name {
            fn id(&self) -> DriverId {
                DriverId::new($id)
            }

            fn role(&self) -> NodeRole {
                $role
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
                        &NodeId::new($id).expect("constant driver id"),
                        &[Capability::ByteSource, Capability::ByteSink],
                    )?;
                }
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
    };
}

source_driver!(
    ModbusTcpDriver,
    ModbusFactory,
    crate::DRIVER_ID,
    NodeRole::Protocol
);
source_driver!(
    ModbusRtuDriver,
    ModbusRtuFactory,
    crate::RTU_DRIVER_ID,
    NodeRole::Protocol
);
