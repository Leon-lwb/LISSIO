//! 协议引擎设备节点的配置、父输入投影和生命周期。
//!
//! 本节点暴露父来源的原始字节，解析和编码由流水线派生的执行图负责。
//! 因而这里不会宣称已经提供解析后的点位、数值通道或转换后字节。

use crate::{
    ByteSourceCapability, Capability, CapabilityMask, CloseError, ConfigError, FrameSubscription,
    NodeContext, NodeDriver, NodeRuntime, OpenError, ParentContract, RuntimeCapabilities,
    ValidatedNodeConfig,
};
use acquisition::{CapabilitySet, PortDescriptor, PortDirection};
use async_trait::async_trait;
use data_model::ConfigurationSchema;
use data_model::device_tree::{ChildPolicy, DriverId, NodeId, NodePath, NodeRole, NodeState};
use flow::{BytesChunk, FlowEnvelope, PayloadKind};
use schema_types::ProtocolNodeConfig;
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::sync::Arc;
use tokio::sync::{broadcast, watch};

/// 内置协议引擎设备节点驱动。
pub const PROTOCOL_ENGINE_DRIVER_ID: &str = "protocol-engine";

/// 为执行图中的协议引擎提供设备树身份和父输入契约。
pub struct ProtocolEngineDriver;

impl ProtocolEngineDriver {
    pub const fn new() -> Self {
        Self
    }
}

impl Default for ProtocolEngineDriver {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl NodeDriver for ProtocolEngineDriver {
    fn id(&self) -> DriverId {
        DriverId::new(PROTOCOL_ENGINE_DRIVER_ID)
    }

    fn role(&self) -> NodeRole {
        NodeRole::Protocol
    }

    fn capabilities(&self) -> CapabilityMask {
        CapabilityMask::only(Capability::ByteSource)
    }

    fn config_schema(&self) -> ConfigurationSchema {
        ConfigurationSchema {
            schema_version: 1,
            json_schema: json!({
                "type": "object",
                "required": ["protocol"],
                "default": ProtocolNodeConfig::default(),
                "properties": {
                    "protocol": { "type": "object", "default": { "kind": "JustFloat", "channels": 4 } },
                    "convertTo": { "type": ["object", "null"], "default": null },
                    "schema": { "type": ["object", "null"], "default": null }
                }
            }),
            ui_hints: json!({ "editor": "protocol-engine" }),
        }
    }

    fn child_policy(&self) -> ChildPolicy {
        ChildPolicy::unlimited([NodeRole::Protocol])
    }

    fn port_descriptors(&self, _config: &Value) -> Vec<PortDescriptor> {
        ports()
    }

    fn validate(
        &self,
        config: &Value,
        parent: Option<&ParentContract>,
    ) -> Result<ValidatedNodeConfig, ConfigError> {
        let node_id = NodeId::new(PROTOCOL_ENGINE_DRIVER_ID).expect("constant protocol node id");
        let parent = parent.ok_or_else(|| ConfigError::MissingParentCapability {
            node_id: node_id.clone(),
            capability: Capability::ByteSource,
        })?;
        parent.require(&node_id, &[Capability::ByteSource])?;
        let parsed: ProtocolNodeConfig =
            serde_json::from_value(config.clone()).map_err(|error| {
                ConfigError::InvalidDriverConfig {
                    node_id,
                    detail: error.to_string(),
                }
            })?;
        Ok(ValidatedNodeConfig::new(self.id(), 1, config.clone()).with_driver_state(parsed))
    }

    async fn open(
        &self,
        config: ValidatedNodeConfig,
        parent: Option<Arc<dyn NodeRuntime>>,
        context: NodeContext,
    ) -> Result<Arc<dyn NodeRuntime>, OpenError> {
        if config.driver_state::<ProtocolNodeConfig>().is_none() {
            return Err(OpenError::Driver {
                node_id: context.node_id().clone(),
                driver_id: self.id(),
                detail: "缺少已验证的协议节点配置".into(),
            });
        }
        let parent = parent.ok_or_else(|| OpenError::ParentUnavailable {
            node_id: context.node_id().clone(),
        })?;
        if parent.as_byte_source().is_none() {
            return Err(OpenError::Driver {
                node_id: context.node_id().clone(),
                driver_id: self.id(),
                detail: "父节点未暴露字节来源端口".into(),
            });
        }
        Ok(Arc::new(ProtocolRuntime {
            node_id: context.node_id().clone(),
            path: context.node_path().clone(),
            driver: self.id(),
            parent,
            ports: ports(),
            closed: watch::channel(false).0,
        }))
    }
}

fn ports() -> Vec<PortDescriptor> {
    [
        ("in", "原始字节输入", PortDirection::Input, false),
        ("out", "原始输入透传", PortDirection::Output, true),
    ]
    .into_iter()
    .map(|(id, name, direction, byte_source)| PortDescriptor {
        id: id.into(),
        display_name: name.into(),
        direction,
        data_domain: PayloadKind::Bytes,
        operations: CapabilitySet {
            byte_source,
            ..CapabilitySet::default()
        },
        address_space: None,
        data_types: BTreeSet::new(),
        display: None,
    })
    .collect()
}

struct ProtocolRuntime {
    node_id: NodeId,
    path: NodePath,
    driver: DriverId,
    parent: Arc<dyn NodeRuntime>,
    ports: Vec<PortDescriptor>,
    closed: watch::Sender<bool>,
}

impl RuntimeCapabilities for ProtocolRuntime {
    fn capability_projection(&self) -> CapabilityMask {
        CapabilityMask::only(Capability::ByteSource)
    }
}

#[async_trait]
impl NodeRuntime for ProtocolRuntime {
    fn node_id(&self) -> &NodeId {
        &self.node_id
    }
    fn path(&self) -> &NodePath {
        &self.path
    }
    fn driver(&self) -> &DriverId {
        &self.driver
    }
    fn state(&self) -> NodeState {
        if *self.closed.borrow() {
            NodeState::Closed
        } else {
            self.parent.state()
        }
    }
    fn port_descriptors(&self) -> &[PortDescriptor] {
        &self.ports
    }
    fn as_byte_source(&self) -> Option<&dyn ByteSourceCapability> {
        Some(self)
    }
    async fn close(&self) -> Result<(), CloseError> {
        self.closed.send_replace(true);
        Ok(())
    }
}

#[async_trait]
impl ByteSourceCapability for ProtocolRuntime {
    fn subscribe_bytes(&self) -> FrameSubscription<FlowEnvelope<BytesChunk>> {
        let (output, receiver) = broadcast::channel(data_model::INGEST_CHANNEL_CAPACITY);
        let mut closed = self.closed.subscribe();
        if *closed.borrow() {
            return FrameSubscription::from_receiver(receiver);
        }
        // 同步建立上游订阅，以免丢失紧随本调用到来的第一包字节。
        let input = self
            .parent
            .as_byte_source()
            .expect("validated parent port")
            .subscribe_bytes();
        let mut input = acquisition::FlowReceiver::from_typed(input.into_receiver());
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    biased;
                    _ = closed.changed() => break,
                    () = output.closed() => break,
                    envelope = input.recv() => match envelope {
                        Ok(envelope) => { if output.send(envelope).is_err() { break; } }
                        Err(_) => break,
                    },
                }
            }
        });
        FrameSubscription::from_receiver(receiver)
    }
}
