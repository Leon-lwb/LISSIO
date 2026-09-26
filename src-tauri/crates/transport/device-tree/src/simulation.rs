//! 仿真虚拟子节点驱动。

use crate::capability::ParentContract;
use crate::driver::{NodeContext, NodeDriver, NodeRuntime, ValidatedNodeConfig};
use crate::error::{ConfigError, OpenError};
use crate::model::{ChildPolicy, DEVICE_TREE_SCHEMA_VERSION, DriverId, NodeRole};
use acquisition::ConfigurationSchema;
use async_trait::async_trait;
use data_model::device::SimulationConfig;
use data_model::device_tree::{
    Capability, CapabilityMask, ConfigError as NodeConfigError, SIMULATION_DRIVER_ID,
};
use serde_json::{Value, json};

/// 将仿真配置打开为独立虚拟子节点。
pub struct SimulationDriver;

impl SimulationDriver {
    /// 创建内置仿真驱动。
    pub const fn new() -> Self {
        Self
    }
}

impl Default for SimulationDriver {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl NodeDriver for SimulationDriver {
    fn id(&self) -> DriverId {
        DriverId::new(SIMULATION_DRIVER_ID)
    }

    fn role(&self) -> NodeRole {
        NodeRole::Virtual
    }

    fn capabilities(&self) -> CapabilityMask {
        CapabilityMask::empty()
    }

    fn runtime_capabilities(
        &self,
        _config: &Value,
        parent: Option<&ParentContract>,
    ) -> CapabilityMask {
        let Some(parent) = parent else {
            return CapabilityMask::empty();
        };
        if parent.capabilities.byte_source {
            CapabilityMask::only(Capability::ByteSource)
        } else {
            CapabilityMask {
                read: parent.capabilities.read,
                subscribe: true,
                ..CapabilityMask::empty()
            }
        }
    }

    fn config_schema(&self) -> ConfigurationSchema {
        ConfigurationSchema {
            schema_version: DEVICE_TREE_SCHEMA_VERSION,
            json_schema: json!({
                "type": "object"
            }),
            ui_hints: json!({}),
        }
    }

    fn child_policy(&self) -> ChildPolicy {
        ChildPolicy::unlimited([NodeRole::Protocol])
    }

    fn validate(
        &self,
        config: &Value,
        parent: Option<&ParentContract>,
    ) -> Result<ValidatedNodeConfig, ConfigError> {
        let node_id =
            crate::model::NodeId::new(SIMULATION_DRIVER_ID).expect("constant simulation node id");
        if parent.is_none() {
            return Err(ConfigError::InvalidDriverConfig {
                node_id,
                detail: "仿真节点必须挂载在来源父节点下".into(),
            });
        }
        let simulation: SimulationConfig = decode_config(config)?;
        acquisition::simulation::validate(&simulation).map_err(|error| {
            ConfigError::InvalidDriverConfig {
                node_id,
                detail: error.to_string(),
            }
        })?;
        Ok(
            ValidatedNodeConfig::new(self.id(), DEVICE_TREE_SCHEMA_VERSION, config.clone())
                .with_driver_state(simulation),
        )
    }

    async fn open(
        &self,
        config: ValidatedNodeConfig,
        parent: Option<Arc<dyn NodeRuntime>>,
        context: NodeContext,
    ) -> Result<Arc<dyn NodeRuntime>, OpenError> {
        let simulation =
            config
                .driver_state::<SimulationConfig>()
                .ok_or_else(|| OpenError::Driver {
                    node_id: context.node_id().clone(),
                    driver_id: self.id(),
                    detail: "缺少已验证的仿真配置句柄".into(),
                })?;
        let parent = parent.ok_or_else(|| OpenError::ParentUnavailable {
            node_id: context.node_id().clone(),
        })?;
        parent
            .as_simulation_provider()
            .ok_or_else(|| OpenError::Driver {
                node_id: context.node_id().clone(),
                driver_id: self.id(),
                detail: "父节点不提供仿真装配端口".into(),
            })?
            .open_simulation((*simulation).clone(), context)
            .await
    }
}

fn decode_config<T: serde::de::DeserializeOwned>(value: &Value) -> Result<T, NodeConfigError> {
    serde_json::from_value(value.clone()).map_err(|error| NodeConfigError::InvalidDriverConfig {
        node_id: crate::model::NodeId::new(SIMULATION_DRIVER_ID)
            .expect("constant simulation node id"),
        detail: error.to_string(),
    })
}

use std::sync::Arc;
