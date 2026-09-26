//! 设备树配置、打开、关闭和端口操作错误。

use data_model::device_tree::{Capability, DriverId, NodeId, NodeState};
use error::Error as LissioError;
use thiserror::Error;

pub use data_model::device_tree::ConfigError;

/// 打开节点或子树失败。
#[derive(Debug, Error)]
pub enum OpenError {
    #[error(transparent)]
    Config(#[from] ConfigError),

    #[error("节点 {node_id} 的驱动 {driver_id} 打开失败: {detail}")]
    Driver {
        node_id: NodeId,
        driver_id: DriverId,
        detail: String,
    },

    #[error(transparent)]
    Contract(#[from] ContractError),

    #[error("节点 {node_id} 的父运行时不可用")]
    ParentUnavailable { node_id: NodeId },

    #[error("节点 {node_id} 打开后不是在线状态，实际状态为 {state:?}")]
    ParentNotOnline { node_id: NodeId, state: NodeState },
}

impl LissioError for OpenError {
    fn kind(&self) -> &'static str {
        "Open"
    }
}

/// 关闭节点失败。关闭过程必须继续释放其余兄弟节点和父节点。
#[derive(Debug, Error)]
#[error("节点 {node_id} 关闭失败: {detail}")]
pub struct CloseError {
    pub node_id: NodeId,
    pub detail: String,
}

impl LissioError for CloseError {
    fn kind(&self) -> &'static str {
        "Close"
    }
}

/// 声明能力与运行时投影不一致。
#[derive(Debug, Error)]
pub enum ContractError {
    #[error("节点 {node_id} 声明能力 {capability:?} 为 {declared}，运行时投影为 {exposed}")]
    CapabilityMismatch {
        node_id: NodeId,
        capability: Capability,
        declared: bool,
        exposed: bool,
    },

    #[error("节点 {node_id} 的能力投影存在 {mismatches} 项不一致")]
    CapabilityClosure { node_id: NodeId, mismatches: usize },

    #[error("节点 {node_id} 的运行时驱动 {runtime_driver} 与注册驱动 {expected_driver} 不一致")]
    RuntimeDriverMismatch {
        node_id: NodeId,
        expected_driver: DriverId,
        runtime_driver: DriverId,
    },

    #[error("节点 {node_id} 的驱动配置校验失败: {detail}")]
    Validation { node_id: NodeId, detail: String },

    #[error("节点 {node_id} 的合同 fixture 打开失败: {detail}")]
    Open { node_id: NodeId, detail: String },

    #[error("节点 {node_id} 首次关闭失败: {detail}")]
    Close { node_id: NodeId, detail: String },

    #[error("节点 {node_id} 重复关闭未保持幂等: {detail}")]
    CloseNotIdempotent { node_id: NodeId, detail: String },
}

impl LissioError for ContractError {
    fn kind(&self) -> &'static str {
        "Contract"
    }
}

/// typed port 写入失败。
#[derive(Debug, Error)]
#[error("节点 {node_id} 的 {operation} 端口操作失败: {detail}")]
pub struct PortError {
    pub node_id: NodeId,
    pub operation: &'static str,
    pub detail: String,
}

impl LissioError for PortError {
    fn kind(&self) -> &'static str {
        "Port"
    }
}
