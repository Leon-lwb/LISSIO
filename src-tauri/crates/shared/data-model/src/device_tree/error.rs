//! Device-tree validation diagnostics.

use super::policy::NodeRole;
use super::state::Capability;
use super::{DriverId, NodeId};
use error::Error as LissioError;

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("节点 id 不能为空")]
    EmptyNodeId,
    #[error("节点名称 {name} 为空或包含路径分隔符")]
    InvalidNodeName { name: String },
    #[error("节点 id {node_id} 在设备树中重复")]
    DuplicateNodeId { node_id: NodeId },
    #[error("父节点 {parent_path} 下的节点名称 {name} 重复")]
    DuplicateSiblingName { parent_path: String, name: String },
    #[error("设备树文档版本 {actual} 不受支持，当前版本为 {expected}")]
    UnsupportedSchemaVersion { expected: u32, actual: u32 },
    #[error("节点 {node_id} 的驱动版本 {actual} 不匹配，驱动要求版本 {expected}")]
    SchemaVersionMismatch {
        node_id: NodeId,
        expected: u32,
        actual: u32,
    },
    #[error("驱动 {driver_id} 已注册")]
    DuplicateDriver { driver_id: DriverId },
    #[error("节点 {node_id} 使用未注册驱动 {driver_id}")]
    UnknownDriver {
        node_id: NodeId,
        driver_id: DriverId,
    },
    #[error("节点 {node_id} 声明驱动 {expected}，实际注册为 {actual}")]
    DriverMismatch {
        node_id: NodeId,
        expected: DriverId,
        actual: DriverId,
    },
    #[error("节点 {node_id} 不允许挂载 {role:?} 子节点")]
    UnsupportedChildRole { node_id: NodeId, role: NodeRole },
    #[error("节点 {node_id} 的 {role:?} 子节点数量 {actual} 超出 [{minimum}, {maximum}]")]
    ChildCountOutOfRange {
        node_id: NodeId,
        role: NodeRole,
        actual: usize,
        minimum: usize,
        maximum: usize,
    },
    #[error("节点 {node_id} 要求父节点提供能力 {capability:?}")]
    MissingParentCapability {
        node_id: NodeId,
        capability: Capability,
    },
    #[error("节点 {node_id} 要求父节点提供端口 {port_id}")]
    MissingParentPort { node_id: NodeId, port_id: String },
    #[error("节点 {node_id} 的驱动配置无效: {detail}")]
    InvalidDriverConfig { node_id: NodeId, detail: String },
}

impl LissioError for ConfigError {
    fn kind(&self) -> &'static str {
        "Config"
    }
}
