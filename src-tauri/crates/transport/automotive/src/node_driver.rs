//! Native CAN-channel node driver over a typed byte parent.

use acquisition::{CapabilitySet, PortDescriptor, PortDirection};
use async_trait::async_trait;
use can::{CanDirection, CanFrame};
use data_model::ConfigurationSchema;
use device_tree::{
    CAN_FRAMES_PORT_ID, CanFrameSinkCapability, CanFrameSourceCapability, Capability,
    CapabilityMask, ChildPolicy, ConfigError, DriverId, FrameSubscription, NodeContext, NodeDriver,
    NodeId, NodePath, NodeRole, NodeRuntime, NodeState, OpenError, ParentContract, PortError,
    RuntimeCapabilities, ValidatedNodeConfig,
};
use flow::{Boundary, BytesChunk, Direction, FlowEnvelope, Framing, SourceId};
use protocol_can_bridge::{CandleEngine, SlcanEngine};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tokio::sync::{Mutex, broadcast};

pub const CAN_CHANNEL_DRIVER_ID: &str = "can-channel";

/// CAN wire encoding carried by the byte parent.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CanEncoding {
    #[default]
    Slcan,
    CandleLight,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanChannelConfig {
    #[serde(default)]
    pub encoding: CanEncoding,
}

/// Native node driver that projects a byte transport into CAN frame ports.
pub struct CanChannelDriver;

impl CanChannelDriver {
    pub const fn new() -> Self {
        Self
    }
}

impl Default for CanChannelDriver {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl NodeDriver for CanChannelDriver {
    fn id(&self) -> DriverId {
        DriverId::new(CAN_CHANNEL_DRIVER_ID)
    }

    fn role(&self) -> NodeRole {
        NodeRole::Protocol
    }

    fn capabilities(&self) -> CapabilityMask {
        CapabilityMask {
            can_frame_source: true,
            can_frame_sink: true,
            ..CapabilityMask::empty()
        }
    }

    fn config_schema(&self) -> ConfigurationSchema {
        ConfigurationSchema {
            schema_version: 1,
            json_schema: json!({
                "type": "object",
                "properties": {
                    "encoding": {
                        "type": "string",
                        "enum": ["slcan", "candleLight"],
                        "default": "slcan"
                    }
                },
                "required": ["encoding"],
                "additionalProperties": false
            }),
            ui_hints: json!({}),
        }
    }

    fn child_policy(&self) -> ChildPolicy {
        ChildPolicy::required(NodeRole::Protocol)
    }

    fn port_descriptors(&self, _config: &Value) -> Vec<PortDescriptor> {
        vec![can_frames_port()]
    }

    fn validate(
        &self,
        config: &Value,
        parent: Option<&ParentContract>,
    ) -> Result<ValidatedNodeConfig, ConfigError> {
        let node_id = NodeId::new(CAN_CHANNEL_DRIVER_ID).expect("constant driver id");
        let config =
            serde_json::from_value::<CanChannelConfig>(config.clone()).map_err(|error| {
                ConfigError::InvalidDriverConfig {
                    node_id: NodeId::new(CAN_CHANNEL_DRIVER_ID).expect("constant driver id"),
                    detail: error.to_string(),
                }
            })?;
        let parent = parent.ok_or_else(|| ConfigError::MissingParentCapability {
            node_id: NodeId::new(CAN_CHANNEL_DRIVER_ID).expect("constant driver id"),
            capability: Capability::ByteSource,
        })?;
        parent.require(&node_id, &[Capability::ByteSource, Capability::ByteSink])?;
        parent.require_ports(&node_id, &["tx", "rx"])?;
        Ok(ValidatedNodeConfig::new(self.id(), 1, json!({})).with_driver_state(config))
    }

    async fn open(
        &self,
        config: ValidatedNodeConfig,
        parent: Option<Arc<dyn NodeRuntime>>,
        context: NodeContext,
    ) -> Result<Arc<dyn NodeRuntime>, OpenError> {
        let config = config
            .driver_state::<CanChannelConfig>()
            .ok_or_else(|| missing_state(&context))?;
        let parent = parent.ok_or_else(|| OpenError::ParentUnavailable {
            node_id: context.node_id().clone(),
        })?;
        let runtime = Arc::new(CanChannelRuntime::new((*config).clone(), parent, context)?);
        runtime.start_decoder();
        Ok(runtime)
    }
}

fn missing_state(context: &NodeContext) -> OpenError {
    OpenError::Driver {
        node_id: context.node_id().clone(),
        driver_id: DriverId::new(CAN_CHANNEL_DRIVER_ID),
        detail: "缺少已验证的 CAN Channel 配置".into(),
    }
}

fn can_frames_port() -> PortDescriptor {
    PortDescriptor {
        id: CAN_FRAMES_PORT_ID.into(),
        display_name: "CAN frames".into(),
        direction: PortDirection::Bidirectional,
        data_domain: flow::PayloadKind::Events,
        operations: CapabilitySet::default(),
        address_space: None,
        data_types: std::collections::BTreeSet::from(["CanFrame".into()]),
        display: None,
    }
}

enum Engine {
    Slcan(SlcanEngine),
    CandleLight(CandleEngine),
}

impl Engine {
    fn new(encoding: CanEncoding) -> Self {
        match encoding {
            CanEncoding::Slcan => Self::Slcan(SlcanEngine::new()),
            CanEncoding::CandleLight => Self::CandleLight(CandleEngine::new()),
        }
    }

    fn feed(&mut self, bytes: &[u8], direction: Direction) -> Vec<CanFrame> {
        match self {
            Self::Slcan(engine) => {
                engine
                    .feed_with_direction(
                        bytes,
                        if direction == Direction::Receive {
                            CanDirection::Rx
                        } else {
                            CanDirection::Tx
                        },
                    )
                    .can_frames
            }
            Self::CandleLight(engine) => protocol::ProtocolEngine::feed(engine, bytes).can_frames,
        }
    }

    fn encode(&mut self, frame: &CanFrame) -> Vec<u8> {
        match self {
            Self::Slcan(engine) => protocol::ProtocolEngine::encode_can(engine, frame),
            Self::CandleLight(engine) => protocol::ProtocolEngine::encode_can(engine, frame),
        }
    }
}

struct CanChannelRuntime {
    config: CanChannelConfig,
    parent: Arc<dyn NodeRuntime>,
    node_id: NodeId,
    node_path: NodePath,
    driver: DriverId,
    state: parking_lot::RwLock<NodeState>,
    frames: broadcast::Sender<CanFrame>,
    ports: Vec<PortDescriptor>,
    send_engine: Arc<Mutex<Engine>>,
    source_id: SourceId,
    sequence: AtomicU64,
    closed: AtomicBool,
    decoder: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl CanChannelRuntime {
    fn new(
        config: CanChannelConfig,
        parent: Arc<dyn NodeRuntime>,
        context: NodeContext,
    ) -> Result<Self, OpenError> {
        let source_id =
            SourceId::new(context.node_id().to_string()).map_err(|error| OpenError::Driver {
                node_id: context.node_id().clone(),
                driver_id: DriverId::new(CAN_CHANNEL_DRIVER_ID),
                detail: error.to_string(),
            })?;
        let (frames, _) = broadcast::channel(data_model::INGEST_CHANNEL_CAPACITY);
        Ok(Self {
            send_engine: Arc::new(Mutex::new(Engine::new(config.encoding))),
            config,
            parent,
            node_id: context.node_id().clone(),
            node_path: context.node_path().clone(),
            driver: DriverId::new(CAN_CHANNEL_DRIVER_ID),
            state: parking_lot::RwLock::new(NodeState::Online {
                connection_epoch: context.connection_epoch(),
            }),
            frames,
            ports: vec![can_frames_port()],
            source_id,
            sequence: AtomicU64::new(0),
            closed: AtomicBool::new(false),
            decoder: Mutex::new(None),
        })
    }

    fn start_decoder(self: &Arc<Self>) {
        let Some(source) = self.parent.as_byte_source() else {
            return;
        };
        let mut input = source.subscribe_bytes();
        let runtime = self.clone();
        let handle = tokio::spawn(async move {
            let mut engine = Engine::new(runtime.config.encoding);
            while let Ok(envelope) = input.recv().await {
                if runtime.closed.load(Ordering::Acquire)
                    || !matches!(runtime.state(), NodeState::Online { .. })
                {
                    break;
                }
                if envelope.gap_before.is_some() {
                    engine = Engine::new(runtime.config.encoding);
                }
                for frame in engine.feed(&envelope.payload.bytes, envelope.direction) {
                    if runtime.frames.send(frame).is_err() {
                        break;
                    }
                }
            }
        });
        if let Ok(mut decoder) = self.decoder.try_lock() {
            *decoder = Some(handle);
        } else {
            handle.abort();
        }
    }
}

impl RuntimeCapabilities for CanChannelRuntime {
    fn capability_projection(&self) -> CapabilityMask {
        CapabilityMask {
            can_frame_source: !self.closed.load(Ordering::Acquire),
            can_frame_sink: !self.closed.load(Ordering::Acquire),
            ..CapabilityMask::empty()
        }
    }
}

#[async_trait]
impl CanFrameSourceCapability for CanChannelRuntime {
    fn subscribe_frames(&self) -> FrameSubscription<CanFrame> {
        FrameSubscription::from_receiver(self.frames.subscribe())
    }
}

#[async_trait]
impl CanFrameSinkCapability for CanChannelRuntime {
    async fn send_frame(&self, frame: &CanFrame) -> Result<(), PortError> {
        if self.closed.load(Ordering::Acquire) {
            return Err(self.port_error("send_frame", "节点已关闭"));
        }
        let sink = self
            .parent
            .as_byte_sink()
            .ok_or_else(|| self.port_error("send_frame", "父节点字节写入端口不可用"))?;
        let encoded = self.send_engine.lock().await.encode(&CanFrame {
            direction: CanDirection::Tx,
            ..frame.clone()
        });
        if encoded.is_empty() {
            return Err(self.port_error("send_frame", "CAN 帧编码为空"));
        }
        let sequence = self.sequence.fetch_add(1, Ordering::AcqRel);
        let epoch = self
            .state
            .read()
            .connection_epoch()
            .ok_or_else(|| self.port_error("send_frame", "节点不在线"))?;
        let envelope = FlowEnvelope {
            source_id: self.source_id.clone(),
            connection_epoch: epoch,
            first_sequence: sequence,
            last_sequence: sequence,
            observed_time_unix_ns: 0,
            direction: Direction::Transmit,
            gap_before: None,
            payload: BytesChunk {
                bytes: encoded.into(),
                framing: Framing::Stream,
                boundary: Boundary::Complete,
            },
        };
        sink.try_send_bytes(&envelope)
    }
}

impl CanChannelRuntime {
    fn port_error(&self, operation: &'static str, detail: impl Into<String>) -> PortError {
        PortError {
            node_id: self.node_id.clone(),
            operation,
            detail: detail.into(),
        }
    }
}

#[async_trait]
impl NodeRuntime for CanChannelRuntime {
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

    fn as_can_frame_source(&self) -> Option<&dyn CanFrameSourceCapability> {
        (!self.closed.load(Ordering::Acquire)).then_some(self as &dyn CanFrameSourceCapability)
    }

    fn as_can_frame_sink(&self) -> Option<&dyn CanFrameSinkCapability> {
        (!self.closed.load(Ordering::Acquire)).then_some(self as &dyn CanFrameSinkCapability)
    }

    async fn close(&self) -> Result<(), device_tree::CloseError> {
        if self.closed.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        let decoder = self.decoder.lock().await.take();
        if let Some(handle) = decoder {
            handle.abort();
        }
        *self.state.write() = NodeState::Closed;
        Ok(())
    }
}
