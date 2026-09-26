//! Runtime device-tree state snapshots and capability vocabulary.

use super::identity::{DriverId, NodeId, NodePath};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum NodeState {
    Disabled,
    Validating,
    Connecting,
    Online { connection_epoch: u64 },
    Degraded { detail: String },
    Backoff { attempt: u32 },
    Closing,
    Closed,
}

impl NodeState {
    pub const fn connection_epoch(&self) -> Option<u64> {
        match self {
            Self::Online { connection_epoch } => Some(*connection_epoch),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum Capability {
    ByteSource,
    ByteSink,
    CanFrameSource,
    CanFrameSink,
    Read,
    Subscribe,
    Write,
    Invoke,
    Browse,
    Discover,
}

pub const ALL_CAPABILITIES: [Capability; 10] = [
    Capability::ByteSource,
    Capability::ByteSink,
    Capability::CanFrameSource,
    Capability::CanFrameSink,
    Capability::Read,
    Capability::Subscribe,
    Capability::Write,
    Capability::Invoke,
    Capability::Browse,
    Capability::Discover,
];

#[allow(clippy::struct_excessive_bools)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityMask {
    pub byte_source: bool,
    pub byte_sink: bool,
    pub can_frame_source: bool,
    pub can_frame_sink: bool,
    pub read: bool,
    pub subscribe: bool,
    pub write: bool,
    pub invoke: bool,
    pub browse: bool,
    pub discover: bool,
}

impl CapabilityMask {
    pub const fn only(capability: Capability) -> Self {
        let mut mask = Self::empty();
        match capability {
            Capability::ByteSource => mask.byte_source = true,
            Capability::ByteSink => mask.byte_sink = true,
            Capability::CanFrameSource => mask.can_frame_source = true,
            Capability::CanFrameSink => mask.can_frame_sink = true,
            Capability::Read => mask.read = true,
            Capability::Subscribe => mask.subscribe = true,
            Capability::Write => mask.write = true,
            Capability::Invoke => mask.invoke = true,
            Capability::Browse => mask.browse = true,
            Capability::Discover => mask.discover = true,
        }
        mask
    }

    pub const fn empty() -> Self {
        Self {
            byte_source: false,
            byte_sink: false,
            can_frame_source: false,
            can_frame_sink: false,
            read: false,
            subscribe: false,
            write: false,
            invoke: false,
            browse: false,
            discover: false,
        }
    }

    pub const fn has(&self, capability: Capability) -> bool {
        match capability {
            Capability::ByteSource => self.byte_source,
            Capability::ByteSink => self.byte_sink,
            Capability::CanFrameSource => self.can_frame_source,
            Capability::CanFrameSink => self.can_frame_sink,
            Capability::Read => self.read,
            Capability::Subscribe => self.subscribe,
            Capability::Write => self.write,
            Capability::Invoke => self.invoke,
            Capability::Browse => self.browse,
            Capability::Discover => self.discover,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct NodeIssue {
    pub error_kind: String,
    pub detail: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct NodeSnapshot {
    pub node_id: NodeId,
    pub node_path: NodePath,
    pub driver: DriverId,
    pub enabled: bool,
    pub state: NodeState,
    pub capabilities: CapabilityMask,
    pub issue: Option<NodeIssue>,
}
