//! Native ISO-TP node driver over a typed CAN-frame parent.

use crate::{IsoTpSession, IsoTpSessionHandle};
use acquisition::{CapabilitySet, PortDescriptor, PortDirection};
use async_trait::async_trait;
use can::CanFrame;
use data_model::ConfigurationSchema;
use data_model::device_tree::{ChildPolicy, DriverId, NodeId, NodePath, NodeRole, NodeState};
use device_tree::{
    CAN_FRAMES_PORT_ID, Capability, CapabilityMask, ConfigError, ISOTP_REQUEST_PORT_ID,
    IsoTpRequestCapability, NodeContext, NodeDriver, NodeRuntime, OpenError, ParentContract,
    PortError, RuntimeCapabilities, ValidatedNodeConfig,
};
use diagnostic::{IsoTpAddressMode, IsoTpConfig};
use error::Result as DataResult;
use flow::PayloadKind;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::sync::Arc;
use tokio::sync::{Mutex, broadcast};

pub const ISOTP_DRIVER_ID: &str = "isotp";

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IsoTpAddressing {
    #[default]
    Normal,
    Extended,
    Mixed,
}

impl From<IsoTpAddressing> for IsoTpAddressMode {
    fn from(value: IsoTpAddressing) -> Self {
        match value {
            IsoTpAddressing::Normal => Self::Normal,
            IsoTpAddressing::Extended => Self::Extended,
            IsoTpAddressing::Mixed => Self::Mixed,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IsoTpNodeConfig {
    pub tx_id: u32,
    pub rx_id: u32,
    #[serde(default)]
    pub block_size: u8,
    #[serde(default)]
    pub st_min: u8,
    #[serde(default)]
    pub address_mode: IsoTpAddressing,
    #[serde(default)]
    pub padding: Option<u8>,
    pub timeout_ms: u32,
}

impl Default for IsoTpNodeConfig {
    fn default() -> Self {
        let config = IsoTpConfig::default();
        Self {
            tx_id: config.tx_id,
            rx_id: config.rx_id,
            block_size: config.block_size,
            st_min: config.st_min,
            address_mode: IsoTpAddressing::Normal,
            padding: config.padding,
            timeout_ms: config.timeout_ms,
        }
    }
}

impl From<IsoTpNodeConfig> for IsoTpConfig {
    fn from(value: IsoTpNodeConfig) -> Self {
        Self {
            tx_id: value.tx_id,
            rx_id: value.rx_id,
            block_size: value.block_size,
            st_min: value.st_min,
            address_mode: value.address_mode.into(),
            padding: value.padding,
            timeout_ms: value.timeout_ms,
        }
    }
}

/// Native ISO-TP protocol node.
pub struct IsoTpNodeDriver;

impl IsoTpNodeDriver {
    pub const fn new() -> Self {
        Self
    }
}

impl Default for IsoTpNodeDriver {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl NodeDriver for IsoTpNodeDriver {
    fn id(&self) -> DriverId {
        DriverId::new(ISOTP_DRIVER_ID)
    }

    fn role(&self) -> NodeRole {
        NodeRole::Protocol
    }

    fn capabilities(&self) -> CapabilityMask {
        CapabilityMask::empty()
    }

    fn config_schema(&self) -> ConfigurationSchema {
        ConfigurationSchema {
            schema_version: 1,
            json_schema: json!({
                "type": "object",
                "properties": {
                    "txId": {"type": "integer", "minimum": 0, "maximum": 536870911},
                    "rxId": {"type": "integer", "minimum": 0, "maximum": 536870911},
                    "blockSize": {"type": "integer", "minimum": 0, "maximum": 255},
                    "stMin": {"type": "integer", "minimum": 0, "maximum": 255},
                    "addressMode": {"type": "string", "enum": ["normal", "extended", "mixed"]},
                    "padding": {"type": ["integer", "null"], "minimum": 0, "maximum": 255},
                    "timeoutMs": {"type": "integer", "minimum": 1}
                },
                "required": ["txId", "rxId", "timeoutMs"],
                "additionalProperties": false
            }),
            ui_hints: json!({}),
        }
    }

    fn child_policy(&self) -> ChildPolicy {
        ChildPolicy::required(NodeRole::Endpoint)
    }

    fn port_descriptors(&self, _config: &Value) -> Vec<PortDescriptor> {
        vec![request_port()]
    }

    fn validate(
        &self,
        config: &Value,
        parent: Option<&ParentContract>,
    ) -> Result<ValidatedNodeConfig, ConfigError> {
        let node_id = NodeId::new(ISOTP_DRIVER_ID).expect("constant driver id");
        let config =
            serde_json::from_value::<IsoTpNodeConfig>(config.clone()).map_err(|error| {
                ConfigError::InvalidDriverConfig {
                    node_id: NodeId::new(ISOTP_DRIVER_ID).expect("constant driver id"),
                    detail: error.to_string(),
                }
            })?;
        if config.tx_id > 0x1FFF_FFFF || config.rx_id > 0x1FFF_FFFF {
            return Err(ConfigError::InvalidDriverConfig {
                node_id,
                detail: "ISO-TP CAN id 超出 29-bit 范围".into(),
            });
        }
        let parent = parent.ok_or_else(|| ConfigError::MissingParentCapability {
            node_id: NodeId::new(ISOTP_DRIVER_ID).expect("constant driver id"),
            capability: Capability::CanFrameSource,
        })?;
        if parent.role != NodeRole::Protocol {
            return Err(ConfigError::InvalidDriverConfig {
                node_id,
                detail: format!("ISO-TP 父节点角色必须为 Protocol，实际为 {:?}", parent.role),
            });
        }
        parent.require(
            &node_id,
            &[Capability::CanFrameSource, Capability::CanFrameSink],
        )?;
        parent.require_ports(&node_id, &[CAN_FRAMES_PORT_ID])?;
        Ok(ValidatedNodeConfig::new(self.id(), 1, json!({})).with_driver_state(config))
    }

    async fn open(
        &self,
        config: ValidatedNodeConfig,
        parent: Option<Arc<dyn NodeRuntime>>,
        context: NodeContext,
    ) -> Result<Arc<dyn NodeRuntime>, OpenError> {
        let config = config
            .driver_state::<IsoTpNodeConfig>()
            .ok_or_else(|| missing_state(&context))?;
        let parent = parent.ok_or_else(|| OpenError::ParentUnavailable {
            node_id: context.node_id().clone(),
        })?;
        let backend = Arc::new(ParentCanBackend {
            parent: parent.clone(),
            node_id: context.node_id().clone(),
        });
        let session = IsoTpSession::new(backend, (*config).clone().into());
        Ok(Arc::new(IsoTpNodeRuntime {
            node_id: context.node_id().clone(),
            node_path: context.node_path().clone(),
            driver: self.id(),
            state: RwLock::new(NodeState::Online {
                connection_epoch: context.connection_epoch(),
            }),
            config: (*config).clone(),
            handle: session.handle(),
            session: Mutex::new(Some(session)),
            ports: vec![request_port()],
            _parent: parent,
        }))
    }
}

fn missing_state(context: &NodeContext) -> OpenError {
    OpenError::Driver {
        node_id: context.node_id().clone(),
        driver_id: DriverId::new(ISOTP_DRIVER_ID),
        detail: "缺少已验证的 ISO-TP 配置".into(),
    }
}

fn request_port() -> PortDescriptor {
    PortDescriptor {
        id: ISOTP_REQUEST_PORT_ID.into(),
        display_name: "ISO-TP request/response".into(),
        direction: PortDirection::Bidirectional,
        data_domain: PayloadKind::Bytes,
        operations: CapabilitySet::default(),
        address_space: None,
        data_types: BTreeSet::from(["IsoTpPayload".into()]),
        display: None,
    }
}

struct ParentCanBackend {
    parent: Arc<dyn NodeRuntime>,
    node_id: NodeId,
}

#[async_trait]
impl transport::CanBackend for ParentCanBackend {
    async fn send_frame(&self, frame: &CanFrame) -> DataResult<()> {
        self.parent
            .as_can_frame_sink()
            .ok_or_else(|| {
                error::AppError::Io(std::io::Error::new(
                    std::io::ErrorKind::Unsupported,
                    "父节点不提供 CAN frame sink",
                ))
            })?
            .send_frame(frame)
            .await
            .map_err(|error| error::AppError::Io(std::io::Error::other(error.to_string())))
    }

    fn subscribe_frames(&self) -> broadcast::Receiver<CanFrame> {
        self.parent.as_can_frame_source().map_or_else(
            || broadcast::channel(1).1,
            |source| source.subscribe_frames().into_receiver(),
        )
    }

    fn name(&self) -> &str {
        self.node_id.as_str()
    }
}

struct IsoTpNodeRuntime {
    node_id: NodeId,
    node_path: NodePath,
    driver: DriverId,
    state: RwLock<NodeState>,
    config: IsoTpNodeConfig,
    handle: IsoTpSessionHandle,
    session: Mutex<Option<IsoTpSession>>,
    ports: Vec<PortDescriptor>,
    _parent: Arc<dyn NodeRuntime>,
}

impl RuntimeCapabilities for IsoTpNodeRuntime {
    fn capability_projection(&self) -> CapabilityMask {
        CapabilityMask::empty()
    }
}

#[async_trait]
impl IsoTpRequestCapability for IsoTpNodeRuntime {
    async fn request(&self, data: Vec<u8>) -> Result<Vec<u8>, PortError> {
        if !matches!(*self.state.read(), NodeState::Online { .. }) {
            return Err(self.port_error("request", "节点不在线"));
        }
        self.handle
            .send_request(self.config.tx_id, self.config.rx_id, data)
            .await
            .map_err(|error| self.port_error("request", error.to_string()))
    }
}

impl IsoTpNodeRuntime {
    fn port_error(&self, operation: &'static str, detail: impl Into<String>) -> PortError {
        PortError {
            node_id: self.node_id.clone(),
            operation,
            detail: detail.into(),
        }
    }
}

#[async_trait]
impl NodeRuntime for IsoTpNodeRuntime {
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

    fn as_isotp_request(&self) -> Option<&dyn IsoTpRequestCapability> {
        matches!(*self.state.read(), NodeState::Online { .. })
            .then_some(self as &dyn IsoTpRequestCapability)
    }

    async fn close(&self) -> Result<(), device_tree::CloseError> {
        let session = self.session.lock().await.take();
        if let Some(session) = session {
            session.shutdown().await;
        }
        *self.state.write() = NodeState::Closed;
        Ok(())
    }
}
