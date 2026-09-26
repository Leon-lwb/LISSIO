//! 设备树内置的无能力虚拟驱动。

use crate::capability::{CapabilityMask, ParentContract, RuntimeCapabilities};
use crate::driver::{
    DriverContractFixture, NodeContext, NodeDriver, NodeRuntime, ParentFixture, ValidatedNodeConfig,
};
use crate::error::{CloseError, ConfigError, ContractError, OpenError};
use crate::model::{
    ChildPolicy, DEVICE_TREE_SCHEMA_VERSION, DriverId, NodeId, NodePath, NodeRole, NodeState,
};
use acquisition::{ConfigurationSchema, PortDescriptor};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// 根分组驱动 id。组合根可注册自己的根驱动覆盖它。
pub const ROOT_DRIVER_ID: &str = "root";

/// 不提供外部能力的根分组驱动。
pub struct RootDriver;

impl RootDriver {
    /// 创建根分组驱动。
    pub const fn new() -> Self {
        Self
    }
}

impl Default for RootDriver {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl NodeDriver for RootDriver {
    fn id(&self) -> DriverId {
        DriverId::new(ROOT_DRIVER_ID)
    }

    fn role(&self) -> NodeRole {
        NodeRole::Virtual
    }

    fn capabilities(&self) -> CapabilityMask {
        CapabilityMask::empty()
    }

    fn config_schema(&self) -> ConfigurationSchema {
        ConfigurationSchema {
            schema_version: DEVICE_TREE_SCHEMA_VERSION,
            json_schema: json!({
                "type": "object",
                "additionalProperties": false
            }),
            ui_hints: json!({}),
        }
    }

    fn child_policy(&self) -> ChildPolicy {
        ChildPolicy::unlimited([
            NodeRole::Bus,
            NodeRole::Protocol,
            NodeRole::Endpoint,
            NodeRole::Virtual,
        ])
    }

    fn validate(
        &self,
        config: &Value,
        _parent: Option<&ParentContract>,
    ) -> Result<ValidatedNodeConfig, ConfigError> {
        if !config.as_object().is_some_and(serde_json::Map::is_empty) {
            return Err(ConfigError::InvalidDriverConfig {
                node_id: NodeId::new(ROOT_DRIVER_ID).expect("constant node id"),
                detail: "根分组配置必须为空对象".into(),
            });
        }
        Ok(ValidatedNodeConfig::new(
            self.id(),
            DEVICE_TREE_SCHEMA_VERSION,
            json!({}),
        ))
    }

    async fn open(
        &self,
        config: ValidatedNodeConfig,
        _parent: Option<Arc<dyn NodeRuntime>>,
        context: NodeContext,
    ) -> Result<Arc<dyn NodeRuntime>, OpenError> {
        Ok(Arc::new(GroupRuntime {
            node_id: context.node_id().clone(),
            node_path: context.node_path().clone(),
            driver: config.driver_id().clone(),
            state: parking_lot::RwLock::new(NodeState::Online {
                connection_epoch: context.connection_epoch(),
            }),
            closed: AtomicBool::new(false),
            ports: Vec::new(),
        }) as Arc<dyn NodeRuntime>)
    }
}

struct GroupRuntime {
    node_id: NodeId,
    node_path: NodePath,
    driver: DriverId,
    state: parking_lot::RwLock<NodeState>,
    closed: AtomicBool,
    ports: Vec<PortDescriptor>,
}

impl RuntimeCapabilities for GroupRuntime {
    fn capability_projection(&self) -> CapabilityMask {
        CapabilityMask::empty()
    }
}

#[async_trait]
impl NodeRuntime for GroupRuntime {
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
        if self.closed.load(Ordering::Acquire) {
            NodeState::Closed
        } else {
            self.state.read().clone()
        }
    }

    fn port_descriptors(&self) -> &[PortDescriptor] {
        &self.ports
    }

    async fn close(&self) -> Result<(), CloseError> {
        self.closed.store(true, Ordering::Release);
        *self.state.write() = NodeState::Closed;
        Ok(())
    }
}

/// 检查运行时合同并验证 `close` 幂等。
pub async fn check_runtime_contract(
    driver: &dyn NodeDriver,
    fixture: &DriverContractFixture,
    runtime: Arc<dyn NodeRuntime>,
) -> Result<(), ContractError> {
    if runtime.driver() != &fixture.driver_id {
        return Err(ContractError::RuntimeDriverMismatch {
            node_id: fixture.node_id.clone(),
            expected_driver: fixture.driver_id.clone(),
            runtime_driver: runtime.driver().clone(),
        });
    }
    let parent_contract = fixture
        .parent
        .as_ref()
        .map(|parent| ParentContract::from_runtime(parent.role, parent.runtime.as_ref()));
    let mismatches = crate::capability::contract_mismatches(
        driver.runtime_capabilities(&fixture.config, parent_contract.as_ref()),
        &fixture.node_id,
        runtime.as_ref(),
    );
    if let Some(first) = mismatches.into_iter().next() {
        let _ = runtime.close().await;
        return Err(first);
    }
    if let Err(error) = runtime.close().await {
        return Err(ContractError::Close {
            node_id: fixture.node_id.clone(),
            detail: error.to_string(),
        });
    }
    if let Err(error) = runtime.close().await {
        return Err(ContractError::CloseNotIdempotent {
            node_id: fixture.node_id.clone(),
            detail: error.to_string(),
        });
    }
    Ok(())
}

/// 为合同检查构造父运行时描述。
pub fn parent_fixture(role: NodeRole, runtime: Arc<dyn NodeRuntime>) -> ParentFixture {
    ParentFixture { role, runtime }
}
