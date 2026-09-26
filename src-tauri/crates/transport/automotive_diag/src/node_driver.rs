//! Native diagnostic endpoint node driver over an ISO-TP parent.

use crate::DiagnosticEngine;
use acquisition::{
    AcquisitionError, AcquisitionResult, CapabilitySet, PortDescriptor, PortDirection,
};
use async_trait::async_trait;
use data_model::ConfigurationSchema;
use device_tree::{
    CapabilityMask, ChildPolicy, ConfigError, DriverId, ISOTP_REQUEST_PORT_ID, InvokeCapability,
    NodeContext, NodeDriver, NodeId, NodePath, NodeRole, NodeRuntime, NodeState, OpenError,
    ParentContract, RuntimeCapabilities, ValidatedNodeConfig,
};
use diagnostic::UdsConfig;
use flow::PayloadKind;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::sync::Arc;

pub const DIAGNOSTIC_DRIVER_ID: &str = "diagnostic";
pub const DIAGNOSTIC_INVOKE_PORT_ID: &str = "diagnostic.invoke";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticNodeConfig {
    pub p2_timeout_ms: u32,
    pub tester_present_interval_ms: u32,
}

impl Default for DiagnosticNodeConfig {
    fn default() -> Self {
        let config = UdsConfig::default();
        Self {
            p2_timeout_ms: config.p2_timeout_ms,
            tester_present_interval_ms: config.tester_present_interval_ms,
        }
    }
}

impl From<DiagnosticNodeConfig> for UdsConfig {
    fn from(value: DiagnosticNodeConfig) -> Self {
        Self {
            p2_timeout_ms: value.p2_timeout_ms,
            tester_present_interval_ms: value.tester_present_interval_ms,
        }
    }
}

/// Native UDS diagnostic endpoint node.
pub struct DiagnosticNodeDriver;

impl DiagnosticNodeDriver {
    pub const fn new() -> Self {
        Self
    }
}

impl Default for DiagnosticNodeDriver {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl NodeDriver for DiagnosticNodeDriver {
    fn id(&self) -> DriverId {
        DriverId::new(DIAGNOSTIC_DRIVER_ID)
    }

    fn role(&self) -> NodeRole {
        NodeRole::Endpoint
    }

    fn capabilities(&self) -> CapabilityMask {
        CapabilityMask::only(device_tree::Capability::Invoke)
    }

    fn config_schema(&self) -> ConfigurationSchema {
        ConfigurationSchema {
            schema_version: 1,
            json_schema: json!({
                "type": "object",
                "properties": {
                    "p2TimeoutMs": {"type": "integer", "minimum": 1},
                    "testerPresentIntervalMs": {"type": "integer", "minimum": 0}
                },
                "required": ["p2TimeoutMs", "testerPresentIntervalMs"],
                "additionalProperties": false
            }),
            ui_hints: json!({
                "methods": [{
                    "name": "request",
                    "params": {
                        "type": "object",
                        "properties": {
                            "data": {
                                "type": "array",
                                "items": {"type": "integer", "minimum": 0, "maximum": 255},
                                "maxItems": 4095
                            }
                        },
                        "required": ["data"],
                        "additionalProperties": false
                    },
                    "errors": ["InvalidParams", "PortUnavailable", "Transport"]
                }]
            }),
        }
    }

    fn child_policy(&self) -> ChildPolicy {
        ChildPolicy::none()
    }

    fn port_descriptors(&self, _config: &Value) -> Vec<PortDescriptor> {
        vec![invoke_port()]
    }

    fn validate(
        &self,
        config: &Value,
        parent: Option<&ParentContract>,
    ) -> Result<ValidatedNodeConfig, ConfigError> {
        let node_id = NodeId::new(DIAGNOSTIC_DRIVER_ID).expect("constant driver id");
        let config =
            serde_json::from_value::<DiagnosticNodeConfig>(config.clone()).map_err(|error| {
                ConfigError::InvalidDriverConfig {
                    node_id: NodeId::new(DIAGNOSTIC_DRIVER_ID).expect("constant driver id"),
                    detail: error.to_string(),
                }
            })?;
        if config.p2_timeout_ms == 0 {
            return Err(ConfigError::InvalidDriverConfig {
                node_id,
                detail: "p2TimeoutMs 必须大于 0".into(),
            });
        }
        let parent = parent.ok_or_else(|| ConfigError::MissingParentPort {
            node_id: NodeId::new(DIAGNOSTIC_DRIVER_ID).expect("constant driver id"),
            port_id: ISOTP_REQUEST_PORT_ID.into(),
        })?;
        if parent.role != NodeRole::Protocol {
            return Err(ConfigError::InvalidDriverConfig {
                node_id,
                detail: format!("诊断父节点角色必须为 Protocol，实际为 {:?}", parent.role),
            });
        }
        parent.require_ports(&node_id, &[ISOTP_REQUEST_PORT_ID])?;
        Ok(ValidatedNodeConfig::new(self.id(), 1, json!({})).with_driver_state(config))
    }

    async fn open(
        &self,
        config: ValidatedNodeConfig,
        parent: Option<Arc<dyn NodeRuntime>>,
        context: NodeContext,
    ) -> Result<Arc<dyn NodeRuntime>, OpenError> {
        let config = config
            .driver_state::<DiagnosticNodeConfig>()
            .ok_or_else(|| missing_state(&context))?;
        let parent = parent.ok_or_else(|| OpenError::ParentUnavailable {
            node_id: context.node_id().clone(),
        })?;
        if parent.as_isotp_request().is_none() {
            return Err(OpenError::Driver {
                node_id: context.node_id().clone(),
                driver_id: self.id(),
                detail: "父节点不提供 ISO-TP 请求/响应端口".into(),
            });
        }
        Ok(Arc::new(DiagnosticNodeRuntime {
            node_id: context.node_id().clone(),
            node_path: context.node_path().clone(),
            driver: self.id(),
            state: RwLock::new(NodeState::Online {
                connection_epoch: context.connection_epoch(),
            }),
            engine: DiagnosticEngine::with_parent(parent.clone(), (*config).into()),
            ports: vec![invoke_port()],
            _parent: parent,
        }))
    }
}

fn missing_state(context: &NodeContext) -> OpenError {
    OpenError::Driver {
        node_id: context.node_id().clone(),
        driver_id: DriverId::new(DIAGNOSTIC_DRIVER_ID),
        detail: "缺少已验证的诊断配置".into(),
    }
}

fn invoke_port() -> PortDescriptor {
    PortDescriptor {
        id: DIAGNOSTIC_INVOKE_PORT_ID.into(),
        display_name: "Diagnostic methods".into(),
        direction: PortDirection::Output,
        data_domain: PayloadKind::Events,
        operations: CapabilitySet {
            method: true,
            ..CapabilitySet::default()
        },
        address_space: None,
        data_types: BTreeSet::from(["DiagnosticMethod".into()]),
        display: None,
    }
}

struct DiagnosticNodeRuntime {
    node_id: NodeId,
    node_path: NodePath,
    driver: DriverId,
    state: RwLock<NodeState>,
    engine: DiagnosticEngine,
    ports: Vec<PortDescriptor>,
    _parent: Arc<dyn NodeRuntime>,
}

impl RuntimeCapabilities for DiagnosticNodeRuntime {
    fn capability_projection(&self) -> CapabilityMask {
        if matches!(*self.state.read(), NodeState::Online { .. }) {
            CapabilityMask::only(device_tree::Capability::Invoke)
        } else {
            CapabilityMask::empty()
        }
    }
}

#[async_trait]
impl InvokeCapability for DiagnosticNodeRuntime {
    async fn invoke(&self, method: &str, args: Value) -> AcquisitionResult<Value> {
        if !matches!(*self.state.read(), NodeState::Online { .. }) {
            return Err(AcquisitionError::Closed);
        }
        if method != "request" {
            return Err(AcquisitionError::Unsupported("diagnostic method"));
        }
        let data = args
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| AcquisitionError::InvalidConfig("request.data 必须为字节数组".into()))?;
        if data.len() > 4095 {
            return Err(AcquisitionError::InvalidConfig(
                "request.data 超出 ISO-TP 4095 字节上限".into(),
            ));
        }
        let data = data
            .iter()
            .map(|value| {
                value
                    .as_u64()
                    .and_then(|byte| u8::try_from(byte).ok())
                    .ok_or_else(|| {
                        AcquisitionError::InvalidConfig("request.data 必须为 0..=255".into())
                    })
            })
            .collect::<AcquisitionResult<Vec<u8>>>()?;
        let response = self
            .engine
            .request(data)
            .await
            .map_err(|error| AcquisitionError::Driver(error.to_string()))?;
        Ok(json!({"data": response}))
    }
}

#[async_trait]
impl NodeRuntime for DiagnosticNodeRuntime {
    fn node_id(&self) -> &NodeId {
        &self.node_id
    }

    fn path(&self) -> &NodePath {
        &self.node_path
    }

    fn driver(&self) -> &DriverId {
        &self.driver
    }

    fn state(&self) -> NodeState {
        self.state.read().clone()
    }

    fn port_descriptors(&self) -> &[PortDescriptor] {
        &self.ports
    }

    fn as_invoker(&self) -> Option<&dyn InvokeCapability> {
        matches!(*self.state.read(), NodeState::Online { .. })
            .then_some(self as &dyn InvokeCapability)
    }

    async fn close(&self) -> Result<(), device_tree::CloseError> {
        *self.state.write() = NodeState::Closed;
        Ok(())
    }
}
