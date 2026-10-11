//! 设备树采集条目和 typed 数据面桥接辅助实现。

use crate::NodeRuntime;
use crate::registry::DriverRegistry;
use crate::runtime::DeviceTreeRuntime;
use acquisition::{
    AcquisitionError, AcquisitionResult, AcquisitionRunState, ExecutionGate, PointBatchObserver,
    StateLane,
};
use data_model::ConnectionState;
use data_model::device_tree::{NodeDecl, NodeSnapshot};
use data_model::device_tree::{NodeId, NodeState};
use error::Result;
use points::{PointDescriptor, PointEnvelope};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use tokio::sync::mpsc;

pub(super) struct OpeningEntry {
    pub(super) canceled: Arc<AtomicBool>,
}

pub(super) fn flatten(node: &NodeDecl) -> Vec<NodeDecl> {
    let mut output = vec![node.clone()];
    for child in &node.children {
        output.extend(flatten(child));
    }
    output
}

pub(super) struct NodeResource {
    pub(super) samples: Arc<StateLane>,
    pub(super) sample_sink: mpsc::Sender<PointEnvelope>,
}

pub(super) struct NodeEntry {
    pub(super) declaration: parking_lot::RwLock<NodeDecl>,
    pub(super) tree: DeviceTreeRuntime,
    pub(super) root_id: NodeId,
    pub(super) effective_node_id: NodeId,
    pub(super) resources: BTreeMap<NodeId, Arc<NodeResource>>,
}

impl NodeEntry {
    pub(super) fn runtime(&self, node_id: &NodeId) -> Option<Arc<dyn NodeRuntime>> {
        self.tree.runtime(node_id)
    }

    pub(super) fn effective_runtime(&self) -> Option<Arc<dyn NodeRuntime>> {
        self.tree.runtime(&self.effective_node_id)
    }

    pub(super) fn resource(&self, node_id: &NodeId) -> AcquisitionResult<Arc<NodeResource>> {
        self.resources
            .get(node_id)
            .cloned()
            .ok_or_else(|| AcquisitionError::UnknownNode(node_id.to_string()))
    }

    pub(super) fn snapshot(&self, node_id: &NodeId) -> AcquisitionResult<NodeSnapshot> {
        self.tree
            .snapshots()
            .into_iter()
            .find(|snapshot| &snapshot.node_id == node_id)
            .ok_or_else(|| AcquisitionError::UnknownNode(node_id.to_string()))
    }
}

pub(super) fn byte_session(
    entry: &NodeEntry,
    node_id: &NodeId,
) -> Result<Arc<dyn acquisition::SourceSession>> {
    entry
        .runtime(node_id)
        .and_then(|runtime| runtime.source_session())
        .filter(|session| session.byte_stream().is_some())
        .ok_or_else(|| {
            error::AppError::PortNotFound(error::PortNotFoundError {
                port: node_id.to_string(),
            })
        })
}

pub(super) fn spawn_sample_consumer(
    samples: Arc<StateLane>,
    mut envelopes: mpsc::Receiver<PointEnvelope>,
    observer: Option<Arc<dyn PointBatchObserver>>,
    execution: ExecutionGate,
) {
    tokio::spawn(async move {
        while let Some(envelope) = envelopes.recv().await {
            // 只有停止丢弃采样; 暂停期间数据链继续 (暂停只停发送)
            if execution.state() == AcquisitionRunState::Stopped {
                continue;
            }
            if let Some(observer) = &observer {
                observer.observe(&envelope);
            }
            for sample in envelope.payload.samples {
                let _ = samples.push(sample);
            }
        }
    });
}

pub(super) fn open_error(error: crate::error::OpenError) -> AcquisitionError {
    AcquisitionError::Driver(error.to_string())
}

pub(super) fn error_text(errors: Vec<crate::error::CloseError>) -> String {
    errors
        .into_iter()
        .map(|error| error.to_string())
        .collect::<Vec<_>>()
        .join("; ")
}

pub(super) fn connection_state(state: NodeState) -> ConnectionState {
    match state {
        NodeState::Online { .. } => ConnectionState::Connected,
        NodeState::Degraded { .. } => ConnectionState::Error,
        NodeState::Closed | NodeState::Closing => ConnectionState::Disconnected,
        _ => ConnectionState::Connecting,
    }
}

pub(super) fn validate_node(declaration: &NodeDecl) -> AcquisitionResult<()> {
    if declaration.id.as_str().trim().is_empty() || declaration.name.trim().is_empty() {
        return Err(AcquisitionError::InvalidConfig(
            "node id and name must not be empty".into(),
        ));
    }
    if !declaration.enabled {
        return Err(AcquisitionError::InvalidConfig(
            "disabled node cannot be opened".into(),
        ));
    }
    Ok(())
}

pub(super) fn effective_node_id(declaration: &NodeDecl) -> NodeId {
    declaration
        .children
        .iter()
        .find(|child| {
            child.enabled && child.driver.as_str() == data_model::device_tree::SIMULATION_DRIVER_ID
        })
        .map_or_else(|| declaration.id.clone(), |child| child.id.clone())
}

pub(super) fn node_points(
    registry: &DriverRegistry,
    declaration: &NodeDecl,
) -> AcquisitionResult<Vec<PointDescriptor>> {
    registry
        .point_descriptors(&declaration.driver, &declaration.config)
        .map_err(|error| AcquisitionError::Driver(error.to_string()))
}

pub(super) fn simulation_config(node: &NodeDecl) -> Option<data_model::device::SimulationConfig> {
    node.children
        .iter()
        .find(|child| {
            child.enabled && child.driver.as_str() == data_model::device_tree::SIMULATION_DRIVER_ID
        })
        .and_then(|child| serde_json::from_value(child.config.clone()).ok())
}

/// Test data follows the first enabled protocol attached to its byte stream.
pub(super) fn protocol_link(node: &NodeDecl) -> Option<schema_types::TestDataLink> {
    node.children
        .iter()
        .filter(|child| child.enabled)
        .find_map(|child| {
            if child.driver.as_str() == "protocol-engine" {
                let config: schema_types::ProtocolNodeConfig =
                    serde_json::from_value(child.config.clone()).ok()?;
                Some(schema_types::TestDataLink {
                    protocol: config.protocol,
                    schema: Some(config.schema),
                })
            } else if child.driver.as_str() == data_model::device_tree::SIMULATION_DRIVER_ID {
                protocol_link(child)
            } else {
                None
            }
        })
}

pub(super) fn only_simulation_changed(current: &NodeDecl, next: &NodeDecl) -> bool {
    let mut current_without_simulation = current.clone();
    let mut next_without_simulation = next.clone();
    current_without_simulation
        .children
        .retain(|child| child.driver.as_str() != data_model::device_tree::SIMULATION_DRIVER_ID);
    next_without_simulation
        .children
        .retain(|child| child.driver.as_str() != data_model::device_tree::SIMULATION_DRIVER_ID);
    let current_simulation = simulation_config(current);
    let next_simulation = simulation_config(next);
    current_without_simulation == next_without_simulation
        && current_simulation != next_simulation
        && next_simulation.is_some()
        && current_simulation.as_ref().is_some_and(|current| {
            next_simulation.as_ref().is_some_and(|next| {
                current.encoding == next.encoding
                    && current.channels == next.channels
                    && current.reference_node_id == next.reference_node_id
            })
        })
}

/// 为需要字节消息的消费者投影 typed flow。
pub(super) fn subscribe_byte_messages(
    mut flow: acquisition::FlowReceiver,
) -> tokio::sync::broadcast::Receiver<acquisition::ByteMessage> {
    let (output, receiver) = tokio::sync::broadcast::channel(data_model::INGEST_CHANNEL_CAPACITY);
    tokio::spawn(async move {
        while let Ok(envelope) = flow.recv().await {
            let message = match envelope.direction {
                flow::Direction::Receive => {
                    acquisition::ByteMessage::from_device(envelope.payload.bytes.to_vec())
                }
                flow::Direction::Transmit => {
                    acquisition::ByteMessage::loopback(envelope.payload.bytes.to_vec())
                }
            };
            if output.send(message).is_err() {
                break;
            }
        }
    });
    receiver
}
