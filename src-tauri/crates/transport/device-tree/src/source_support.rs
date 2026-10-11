//! Source-session runtime support shared by native node drivers.
//!
//! Production drivers implement `NodeDriver` directly. This module owns only
//! session-backed runtime mechanics.

use crate::capability::CapabilityMask;
use crate::driver::{NodeContext, NodeRuntime};
use crate::error::OpenError;
use crate::source_runtime::SourceRuntime;
use acquisition::{
    AddressSpaceDescriptor, CapabilitySet, ExecutionGate, PortDescriptor, SourceFactory,
    SourceSupervisor, ValidatedConfig,
};
use data_model::device::DriverPayload;
use data_model::device_tree::{DriverId, NodeRole};
use flow::SourceId;
use parking_lot::Mutex;
use std::sync::Arc;
use tokio::sync::mpsc;

pub const SOURCE_CHANNEL_CAPACITY: usize = 256;

/// Validated source handle retained between `NodeDriver::validate` and `open`.
pub struct SourceValidationState {
    validated: Mutex<Option<ValidatedConfig>>,
}

impl SourceValidationState {
    pub const fn new(validated: ValidatedConfig) -> Self {
        Self {
            validated: Mutex::new(Some(validated)),
        }
    }

    pub fn take(&self) -> Option<ValidatedConfig> {
        self.validated.lock().take()
    }
}

/// Session-backed runtime builder used by native source drivers.
pub struct SourceRuntimeBuilder {
    factory: Arc<dyn SourceFactory>,
    payload: DriverPayload,
    ports: Vec<PortDescriptor>,
    address_spaces: Vec<AddressSpaceDescriptor>,
    discover: bool,
    browse: bool,
    declared: CapabilityMask,
    execution: ExecutionGate,
}

impl SourceRuntimeBuilder {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        factory: Arc<dyn SourceFactory>,
        payload: DriverPayload,
        ports: Vec<PortDescriptor>,
        address_spaces: Vec<AddressSpaceDescriptor>,
        discover: bool,
        browse: bool,
        declared: CapabilityMask,
        execution: ExecutionGate,
    ) -> Self {
        Self {
            factory,
            payload,
            ports,
            address_spaces,
            discover,
            browse,
            declared,
            execution,
        }
    }

    /// Build the parent assembly runtime without opening a real source session.
    pub fn assembly(self, context: &NodeContext) -> Arc<dyn NodeRuntime> {
        Arc::new(SourceRuntime::new_assembly(
            context.node_id().clone(),
            context.node_path().clone(),
            DriverId::new(self.payload.driver_id.as_str()),
            self.factory,
            self.payload,
            context.connection_epoch(),
            self.ports,
            self.address_spaces,
            self.discover,
            self.browse,
            self.declared,
            self.execution,
        ))
    }

    /// Open a direct or supervised source runtime.
    pub async fn open(
        self,
        validated: Option<ValidatedConfig>,
        supervisor: Option<SourceSupervisor>,
        context: &NodeContext,
    ) -> Result<Arc<dyn NodeRuntime>, OpenError> {
        if context.simulation_assembly() {
            return Ok(self.assembly(context));
        }
        let validated = validated.ok_or_else(|| OpenError::Driver {
            node_id: context.node_id().clone(),
            driver_id: DriverId::new(self.payload.driver_id.as_str()),
            detail: "缺少已验证的来源配置句柄".into(),
        })?;
        let source_id =
            SourceId::new(context.node_id().to_string()).map_err(|error| OpenError::Driver {
                node_id: context.node_id().clone(),
                driver_id: DriverId::new(self.payload.driver_id.as_str()),
                detail: error.to_string(),
            })?;
        let (state_sink, _state_rx) = mpsc::channel(SOURCE_CHANNEL_CAPACITY);
        let (event_sink, _event_rx) = mpsc::channel(SOURCE_CHANNEL_CAPACITY);
        let driver_context = acquisition::DriverContext {
            connection_epoch: context.connection_epoch(),
            source_id,
            state_sink,
            event_sink,
            execution: self.execution.clone(),
        };
        if let Some(supervisor) = supervisor {
            let handle = Arc::new(supervisor.spawn_with_validated(
                self.factory.clone(),
                Some(validated),
                self.payload.clone(),
                driver_context,
            ));
            handle.wait_for_settled().await;
            return Ok(Arc::new(SourceRuntime::new_supervised(
                context.node_id().clone(),
                context.node_path().clone(),
                DriverId::new(self.payload.driver_id.as_str()),
                self.factory,
                self.payload,
                handle,
                self.ports,
                self.address_spaces,
                self.discover,
                self.browse,
                self.declared,
                self.execution,
                context.state_events(),
                context.connection_epoch(),
            )));
        }

        let session = self
            .factory
            .open(validated, driver_context)
            .await
            .map_err(|error| OpenError::Driver {
                node_id: context.node_id().clone(),
                driver_id: DriverId::new(self.payload.driver_id.as_str()),
                detail: error.to_string(),
            })?;
        if let Err(error) = acquisition::validate_capability_contract(session.as_ref()) {
            let _ = session.close().await;
            return Err(OpenError::Driver {
                node_id: context.node_id().clone(),
                driver_id: self.payload.driver_id.clone(),
                detail: error.to_string(),
            });
        }
        Ok(Arc::new(SourceRuntime::new(
            context.node_id().clone(),
            context.node_path().clone(),
            DriverId::new(self.payload.driver_id.as_str()),
            self.factory,
            self.payload,
            Arc::from(session),
            self.ports,
            self.address_spaces,
            self.discover,
            self.browse,
            self.declared,
            self.execution,
        )))
    }
}

/// Convert acquisition capability declarations into the device-tree mask.
pub const fn source_capability_mask(capabilities: CapabilitySet) -> CapabilityMask {
    CapabilityMask {
        byte_source: capabilities.byte_source,
        byte_sink: capabilities.byte_sink,
        can_frame_source: false,
        can_frame_sink: false,
        read: capabilities.read,
        subscribe: capabilities.subscribe,
        write: capabilities.write,
        invoke: capabilities.method,
        browse: capabilities.browse,
        discover: capabilities.discover,
    }
}

/// Standard optional simulation child policy for source-backed drivers.
pub fn source_child_policy(role: NodeRole) -> data_model::device_tree::ChildPolicy {
    use data_model::device_tree::{ChildLimit, ChildPolicy};
    use std::collections::BTreeMap;
    let mut allowed = BTreeMap::new();
    allowed.insert(NodeRole::Virtual, ChildLimit::optional_one());
    if matches!(role, NodeRole::Bus | NodeRole::Virtual) {
        allowed.insert(NodeRole::Protocol, ChildLimit::optional());
    }
    allowed.insert(NodeRole::Endpoint, ChildLimit::optional());
    ChildPolicy { allowed }
}

/// Build a driver payload for source factories from a validated node config.
pub fn source_payload(
    driver_id: &str,
    schema_version: u32,
    config: &serde_json::Value,
) -> DriverPayload {
    DriverPayload {
        driver_id: data_model::device_tree::DriverId::new(driver_id),
        schema_version,
        payload: config.clone(),
    }
}
