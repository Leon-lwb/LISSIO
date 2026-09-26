//! Device-tree model types are defined by `data_model` so graph and acquisition can share them.

pub use data_model::device_tree::{
    ChildLimit, ChildPolicy, DEVICE_TREE_SCHEMA_VERSION, DeviceTreeDocument, DriverId, NodeDecl,
    NodeId, NodeIssue, NodePath, NodeRole, NodeSnapshot, NodeState,
};
