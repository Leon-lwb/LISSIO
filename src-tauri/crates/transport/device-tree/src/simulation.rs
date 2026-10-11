//! 仿真虚拟子节点驱动。

use crate::capability::ParentContract;
use crate::driver::{NodeContext, NodeDriver, NodeRuntime, ValidatedNodeConfig};
use crate::error::{ConfigError, OpenError};
use async_trait::async_trait;
use data_model::ConfigurationSchema;
use data_model::device::SimulationConfig;
use data_model::device_tree::{
    Capability, CapabilityMask, ConfigError as NodeConfigError, SIMULATION_DRIVER_ID,
};
use data_model::device_tree::{ChildPolicy, DEVICE_TREE_SCHEMA_VERSION, DriverId, NodeRole};
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

    fn display_name(&self) -> String {
        "Simulation".to_owned()
    }

    /// 配置 schema: 波形/编码候选项由 data_model 的 SimulationConfig 枚举生成,
    /// 不再手写第二份白名单。表单仅支持本项目 schema 子集。
    fn config_schema(&self) -> ConfigurationSchema {
        ConfigurationSchema {
            schema_version: DEVICE_TREE_SCHEMA_VERSION,
            json_schema: json!({
                "type": "object",
                "properties": {
                    "signal": {
                        "type": "object",
                        "properties": {
                            "waveform": { "type": "string", "enum": ["sine", "square", "triangle", "sawtooth", "random", "dc"] },
                            "frequency": { "type": "number", "minimum": 0 },
                            "amplitude": { "type": "number", "minimum": 0 },
                            "offset": { "type": "number" },
                        },
                    },
                    "sampleRate": { "type": "integer", "minimum": 1 },
                    "seed": { "type": "integer", "minimum": 0 },
                    "channels": { "type": "integer", "minimum": 1, "maximum": 64 },
                },
            }),
            ui_hints: json!({}),
        }
    }

    /// 默认仿真配置 — 由 node_id 确定性派生 (重复请求不产生不同 ID)。
    fn default_config(&self, node_id: &str) -> Option<Value> {
        let mut config = SimulationConfig::default();
        // 空工作区种子约定: 默认正弦, 4 通道; 后续 patch 可覆盖
        config.signal.waveform = data_model::device::TestWaveform::Sine;
        config.encoding = Some(json!({
            "protocol": { "kind": "JustFloat", "channels": config.channels },
            "schema": schema_types::justfloat_schema(Some(usize::try_from(config.channels).unwrap_or(4))),
        }));
        let _ = node_id; // 当前默认不含子 ID; 保留参数供派生型驱动使用
        serde_json::to_value(config).ok()
    }

    fn child_policy(&self) -> ChildPolicy {
        ChildPolicy::unlimited([NodeRole::Protocol])
    }

    fn validate(
        &self,
        config: &Value,
        parent: Option<&ParentContract>,
    ) -> Result<ValidatedNodeConfig, ConfigError> {
        let node_id = data_model::device_tree::NodeId::new(SIMULATION_DRIVER_ID)
            .expect("constant simulation node id");
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
        node_id: data_model::device_tree::NodeId::new(SIMULATION_DRIVER_ID)
            .expect("constant simulation node id"),
        detail: error.to_string(),
    })
}

use std::sync::Arc;
