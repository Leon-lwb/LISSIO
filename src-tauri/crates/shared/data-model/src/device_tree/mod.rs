//! Stable persisted device-tree contracts shared by graph, acquisition, and
//! runtimes.
//!
//! Split by responsibility:
//! - [`error`]: validation diagnostics (`ConfigError`).
//! - [`identity`]: `NodeId`, `NodePath`, `DriverId` string newtypes.
//! - [`policy`]: `NodeRole`, `ChildLimit`, `ChildPolicy` composition rules.
//! - [`decl`]: persisted declarations (`NodeDecl`, `DeviceTreeDocument`).
//! - [`state`]: runtime snapshots (`NodeState`, capabilities, issues).

mod decl;
mod error;
mod identity;
mod policy;
mod state;

pub use decl::{DeviceTreeDocument, NodeDecl};
pub use error::ConfigError;
pub use identity::{DriverId, NodeId, NodePath};
pub use policy::{ChildLimit, ChildPolicy, NodeRole};
pub use state::{ALL_CAPABILITIES, Capability, CapabilityMask, NodeIssue, NodeSnapshot, NodeState};

pub const DEVICE_TREE_SCHEMA_VERSION: u32 = 1;
pub const SIMULATION_DRIVER_ID: &str = "simulation";
