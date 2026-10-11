//! Diagnostic endpoint engine backed by the parent ISO-TP typed port.

use device_tree::{NodeRuntime, PortError};
use diagnostic::UdsConfig;
use std::sync::Arc;

/// UDS diagnostic endpoint runtime core.
pub struct DiagnosticEngine {
    parent: Option<Arc<dyn NodeRuntime>>,
    config: UdsConfig,
}

impl DiagnosticEngine {
    /// Create an unattached placeholder for compatibility and discovery tests.
    pub const fn new() -> Self {
        Self {
            parent: None,
            config: UdsConfig {
                p2_timeout_ms: 0,
                tester_present_interval_ms: 0,
            },
        }
    }

    /// Attach the engine to a parent node exposing an ISO-TP request/response port.
    pub const fn with_parent(parent: Arc<dyn NodeRuntime>, config: UdsConfig) -> Self {
        Self {
            parent: Some(parent),
            config,
        }
    }

    /// Whether the engine is attached to a live transport port.
    pub const fn is_ready(&self) -> bool {
        self.parent.is_some()
    }

    /// UDS P2 timeout in milliseconds.
    pub const fn p2_timeout_ms(&self) -> u32 {
        self.config.p2_timeout_ms
    }

    /// Send one UDS payload over ISO-TP and return the raw response payload.
    pub async fn request(&self, data: Vec<u8>) -> Result<Vec<u8>, PortError> {
        let parent = self.parent.as_ref().ok_or_else(|| PortError {
            node_id: data_model::device_tree::NodeId::new("diagnostic").expect("constant node id"),
            operation: "request",
            detail: "诊断引擎未连接 ISO-TP 端口".into(),
        })?;
        parent
            .as_isotp_request()
            .ok_or_else(|| PortError {
                node_id: self.node_id(),
                operation: "request",
                detail: "父节点未暴露 ISO-TP 请求/响应端口".into(),
            })?
            .request(data)
            .await
    }

    fn node_id(&self) -> data_model::device_tree::NodeId {
        self.parent.as_ref().map_or_else(
            || data_model::device_tree::NodeId::new("diagnostic").expect("constant node id"),
            |parent| parent.node_id().clone(),
        )
    }

    /// Return the linked `libautomotive` version.
    pub const fn libautomotive_version() -> &'static str {
        libautomotive::VERSION
    }
}

impl Default for DiagnosticEngine {
    fn default() -> Self {
        Self::new()
    }
}
