//! 驱动注册、拓扑校验和驱动合同闭环。

use crate::builtin::{RootDriver, check_runtime_contract};
use crate::capability::{CapabilityMask, ParentContract};
use crate::driver::{
    DriverContractFixture, NodeContext, NodeDriver, ParentFixture, ValidatedNodeConfig,
};
use crate::error::{ConfigError, ContractError};
use acquisition::{AdapterCapability, DiscoveredEndpoint, PortDescriptor};
use data_model::ConfigurationSchema;
use data_model::device_tree::{
    DEVICE_TREE_SCHEMA_VERSION, DeviceTreeDocument, DriverId, NodeDecl, NodeId, NodePath, NodeRole,
};
use parking_lot::RwLock;
use points::PointDescriptor;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// 驱动目录的可序列化能力投影。
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DriverProjection {
    pub driver_id: DriverId,
    pub role: NodeRole,
    pub capabilities: CapabilityMask,
    pub config_schema: ConfigurationSchema,
    pub ports: Vec<PortDescriptor>,
    #[serde(default)]
    pub child_policy: data_model::device_tree::ChildPolicy,
}

/// 只读驱动目录。注册表内部加锁，不向外暴露可变锁。
pub struct DriverRegistry {
    drivers: RwLock<BTreeMap<DriverId, Arc<dyn NodeDriver>>>,
}

impl DriverRegistry {
    /// 创建带根分组驱动的注册表。
    pub fn new() -> Self {
        let registry = Self {
            drivers: RwLock::new(BTreeMap::new()),
        };
        registry
            .register(Arc::new(RootDriver::new()))
            .expect("fresh registry has no duplicate root driver");
        registry
            .register(Arc::new(crate::simulation::SimulationDriver::new()))
            .expect("fresh registry has no duplicate simulation driver");
        registry
            .register(Arc::new(crate::protocol_engine::ProtocolEngineDriver::new()))
            .expect("fresh registry has no duplicate protocol engine driver");
        registry
    }

    /// 注册驱动；重复 id 直接拒绝，避免拓扑行为静默漂移。
    pub fn register(&self, driver: Arc<dyn NodeDriver>) -> Result<(), ConfigError> {
        let id = driver.id();
        let mut drivers = self.drivers.write();
        if drivers.contains_key(&id) {
            return Err(ConfigError::DuplicateDriver { driver_id: id });
        }
        drivers.insert(id, driver);
        Ok(())
    }

    /// 查询驱动。
    pub fn get(&self, driver_id: &DriverId) -> Option<Arc<dyn NodeDriver>> {
        self.drivers.read().get(driver_id).cloned()
    }

    /// 已注册驱动 id。
    pub fn driver_ids(&self) -> BTreeSet<DriverId> {
        self.drivers.read().keys().cloned().collect()
    }

    /// 返回驱动配置 schema。
    pub fn config_schema(&self, driver_id: &DriverId) -> Result<ConfigurationSchema, ConfigError> {
        self.get(driver_id)
            .map(|driver| driver.config_schema())
            .ok_or_else(|| unknown_driver(driver_id))
    }

    /// 校验单个驱动配置并返回驱动私有已验证句柄。
    pub fn validate_config(
        &self,
        driver_id: &DriverId,
        config: &serde_json::Value,
        parent: Option<&ParentContract>,
    ) -> Result<ValidatedNodeConfig, ConfigError> {
        self.get(driver_id)
            .ok_or_else(|| unknown_driver(driver_id))?
            .validate(config, parent)
    }

    /// 返回配置和父契约对应的完整驱动能力投影。
    pub fn capability_projection(
        &self,
        driver_id: &DriverId,
        config: &serde_json::Value,
        parent: Option<&ParentContract>,
    ) -> Result<DriverProjection, ConfigError> {
        let driver = self
            .get(driver_id)
            .ok_or_else(|| unknown_driver(driver_id))?;
        Ok(DriverProjection {
            driver_id: driver.id(),
            role: driver.role(),
            capabilities: driver.runtime_capabilities(config, parent),
            config_schema: driver.config_schema(),
            ports: driver.port_descriptors(config),
            child_policy: driver.child_policy(),
        })
    }

    /// 返回静态驱动目录投影，供能力卡片和配置表单冷路径使用。
    pub fn manifests(&self) -> Vec<DriverProjection> {
        self.drivers
            .read()
            .values()
            .map(|driver| DriverProjection {
                driver_id: driver.id(),
                role: driver.role(),
                capabilities: driver.capabilities(),
                config_schema: driver.config_schema(),
                ports: driver.port_descriptors(&serde_json::Value::Null),
                child_policy: driver.child_policy(),
            })
            .collect()
    }

    /// 返回产品能力目录。
    pub fn adapter_capabilities(&self) -> Vec<AdapterCapability> {
        self.drivers
            .read()
            .values()
            .filter_map(|driver| driver.adapter_capability())
            .collect()
    }

    /// 返回驱动发现结果。
    pub fn discover(
        &self,
        driver_id: &DriverId,
    ) -> acquisition::AcquisitionResult<Vec<DiscoveredEndpoint>> {
        self.get(driver_id)
            .ok_or_else(|| acquisition::AcquisitionError::UnknownDriver(driver_id.to_string()))?
            .discover()
    }

    /// 返回配置对应的点位描述。
    pub fn point_descriptors(
        &self,
        driver_id: &DriverId,
        config: &serde_json::Value,
    ) -> acquisition::AcquisitionResult<Vec<PointDescriptor>> {
        self.get(driver_id)
            .ok_or_else(|| acquisition::AcquisitionError::UnknownDriver(driver_id.to_string()))?
            .point_descriptors(config)
    }

    /// 校验文档格式、稳定身份、兄弟名称、驱动配置和 `ChildPolicy`。
    pub fn validate(&self, document: &DeviceTreeDocument) -> Result<(), ConfigError> {
        if document.schema_version != DEVICE_TREE_SCHEMA_VERSION {
            return Err(ConfigError::UnsupportedSchemaVersion {
                expected: DEVICE_TREE_SCHEMA_VERSION,
                actual: document.schema_version,
            });
        }
        document.paths()?;
        let mut roles = BTreeMap::<NodeId, NodeRole>::new();
        collect_roles(self, &document.root, &mut roles)?;
        validate_node(self, &document.root, None, &roles)
    }

    /// 对驱动 fixture 执行配置、父端口、能力闭环和 `close` 幂等检查。
    pub async fn contract_check(
        &self,
        fixture: DriverContractFixture,
    ) -> Result<(), ContractError> {
        let driver = self
            .get(&fixture.driver_id)
            .ok_or_else(|| ContractError::Validation {
                node_id: fixture.node_id.clone(),
                detail: format!("未注册驱动 {}", fixture.driver_id),
            })?;
        let parent_contract = fixture.parent.as_ref().map(|parent: &ParentFixture| {
            ParentContract::from_runtime(parent.role, parent.runtime.as_ref())
        });
        let validated = driver
            .validate(&fixture.config, parent_contract.as_ref())
            .map_err(|error| ContractError::Validation {
                node_id: fixture.node_id.clone(),
                detail: error.to_string(),
            })?;
        let context = NodeContext::new(
            fixture.node_id.clone(),
            NodePath::root(fixture.node_id.as_str()).map_err(|error| {
                ContractError::Validation {
                    node_id: fixture.node_id.clone(),
                    detail: error.to_string(),
                }
            })?,
            1,
            tokio::sync::broadcast::channel(1).0,
        );
        let parent = fixture.parent.as_ref().map(|parent| parent.runtime.clone());
        let runtime = driver
            .open(validated, parent, context)
            .await
            .map_err(|error| ContractError::Open {
                node_id: fixture.node_id.clone(),
                detail: error.to_string(),
            })?;
        check_runtime_contract(driver.as_ref(), &fixture, runtime).await
    }
}

impl Default for DriverRegistry {
    fn default() -> Self {
        Self::new()
    }
}

fn unknown_driver(driver_id: &DriverId) -> ConfigError {
    ConfigError::UnknownDriver {
        node_id: NodeId::new("driver-catalog").expect("constant catalog node id"),
        driver_id: driver_id.clone(),
    }
}

fn collect_roles(
    registry: &DriverRegistry,
    node: &NodeDecl,
    output: &mut BTreeMap<NodeId, NodeRole>,
) -> Result<(), ConfigError> {
    let driver = registry
        .get(&node.driver)
        .ok_or_else(|| ConfigError::UnknownDriver {
            node_id: node.id.clone(),
            driver_id: node.driver.clone(),
        })?;
    output.insert(node.id.clone(), driver.role());
    for child in &node.children {
        collect_roles(registry, child, output)?;
    }
    Ok(())
}

fn validate_node(
    registry: &DriverRegistry,
    node: &NodeDecl,
    parent: Option<&ParentContract>,
    roles: &BTreeMap<NodeId, NodeRole>,
) -> Result<(), ConfigError> {
    let driver = registry
        .get(&node.driver)
        .ok_or_else(|| ConfigError::UnknownDriver {
            node_id: node.id.clone(),
            driver_id: node.driver.clone(),
        })?;
    if driver.id() != node.driver {
        return Err(ConfigError::DriverMismatch {
            node_id: node.id.clone(),
            expected: node.driver.clone(),
            actual: driver.id(),
        });
    }
    let schema = driver.config_schema();
    if node.schema_version != schema.schema_version {
        return Err(ConfigError::SchemaVersionMismatch {
            node_id: node.id.clone(),
            expected: schema.schema_version,
            actual: node.schema_version,
        });
    }
    let validated = driver.validate(&node.config, parent)?;
    if validated.driver_id() != &node.driver {
        return Err(ConfigError::DriverMismatch {
            node_id: node.id.clone(),
            expected: node.driver.clone(),
            actual: validated.driver_id().clone(),
        });
    }
    driver
        .child_policy()
        .validate(&node.id, &node.children, roles)?;
    let contract = ParentContract {
        role: driver.role(),
        capabilities: driver.runtime_capabilities(&node.config, parent),
        port_descriptors: driver.port_descriptors(&node.config),
    };
    for child in &node.children {
        validate_node(registry, child, Some(&contract), roles)?;
    }
    Ok(())
}
