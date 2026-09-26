//! Stable persisted device-tree contracts shared by graph, acquisition, and runtimes.

use error::Error as LissioError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

pub const DEVICE_TREE_SCHEMA_VERSION: u32 = 1;
pub const SIMULATION_DRIVER_ID: &str = "simulation";

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

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct NodeId(String);

impl NodeId {
    pub fn new(value: impl AsRef<str>) -> Result<Self, ConfigError> {
        let value = value.as_ref().trim();
        if value.is_empty() {
            return Err(ConfigError::EmptyNodeId);
        }
        Ok(Self(value.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct NodePath(String);

impl NodePath {
    pub fn root(name: &str) -> Result<Self, ConfigError> {
        validate_name(name)?;
        Ok(Self(format!("/{name}")))
    }

    pub fn child(&self, name: &str) -> Result<Self, ConfigError> {
        validate_name(name)?;
        Ok(Self(format!("{}/{name}", self.0)))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn parent(&self) -> Option<Self> {
        let text = self.as_str();
        let index = text.rfind('/')?;
        if index == 0 {
            None
        } else {
            Some(Self(text[..index].to_string()))
        }
    }
}

impl fmt::Display for NodePath {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

fn validate_name(name: &str) -> Result<(), ConfigError> {
    if name.trim().is_empty() || name.contains('/') {
        return Err(ConfigError::InvalidNodeName {
            name: name.to_string(),
        });
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DriverId(pub String);

impl DriverId {
    pub fn new(value: impl AsRef<str>) -> Self {
        Self(value.as_ref().to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for DriverId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NodeRole {
    Bus,
    Protocol,
    Endpoint,
    Virtual,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildLimit {
    pub minimum: usize,
    pub maximum: Option<usize>,
}

impl ChildLimit {
    pub const fn optional() -> Self {
        Self {
            minimum: 0,
            maximum: None,
        }
    }

    pub const fn optional_one() -> Self {
        Self {
            minimum: 0,
            maximum: Some(1),
        }
    }

    fn validate_count(
        &self,
        node_id: &NodeId,
        role: NodeRole,
        actual: usize,
    ) -> Result<(), ConfigError> {
        let maximum = self.maximum.unwrap_or(usize::MAX);
        if actual < self.minimum || actual > maximum {
            return Err(ConfigError::ChildCountOutOfRange {
                node_id: node_id.clone(),
                role,
                actual,
                minimum: self.minimum,
                maximum,
            });
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildPolicy {
    pub allowed: BTreeMap<NodeRole, ChildLimit>,
}

impl ChildPolicy {
    pub const fn none() -> Self {
        Self {
            allowed: BTreeMap::new(),
        }
    }

    pub fn unlimited(roles: impl IntoIterator<Item = NodeRole>) -> Self {
        Self {
            allowed: roles
                .into_iter()
                .map(|role| (role, ChildLimit::optional()))
                .collect(),
        }
    }

    pub fn optional_one(role: NodeRole) -> Self {
        Self {
            allowed: BTreeMap::from([(role, ChildLimit::optional_one())]),
        }
    }

    pub fn required(role: NodeRole) -> Self {
        Self {
            allowed: BTreeMap::from([(
                role,
                ChildLimit {
                    minimum: 1,
                    maximum: Some(1),
                },
            )]),
        }
    }

    pub fn is_required(&self, role: NodeRole) -> bool {
        self.allowed
            .get(&role)
            .is_some_and(|limit| limit.minimum > 0)
    }

    pub fn validate(
        &self,
        node_id: &NodeId,
        children: &[NodeDecl],
        driver_roles: &BTreeMap<NodeId, NodeRole>,
    ) -> Result<(), ConfigError> {
        let mut counts = BTreeMap::<NodeRole, usize>::new();
        for child in children {
            let role =
                driver_roles
                    .get(&child.id)
                    .copied()
                    .ok_or_else(|| ConfigError::UnknownDriver {
                        node_id: child.id.clone(),
                        driver_id: child.driver.clone(),
                    })?;
            if !self.allowed.contains_key(&role) {
                return Err(ConfigError::UnsupportedChildRole {
                    node_id: node_id.clone(),
                    role,
                });
            }
            *counts.entry(role).or_default() += 1;
        }
        for (role, limit) in &self.allowed {
            limit.validate_count(node_id, *role, counts.get(role).copied().unwrap_or(0))?;
        }
        Ok(())
    }
}

impl Default for ChildPolicy {
    fn default() -> Self {
        Self::none()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeDecl {
    pub id: NodeId,
    pub name: String,
    pub driver: DriverId,
    pub schema_version: u32,
    pub config: Value,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability_endpoint_id: Option<String>,
    #[serde(default)]
    pub children: Vec<Self>,
}

impl NodeDecl {
    pub fn leaf(
        id: impl AsRef<str>,
        name: impl Into<String>,
        driver: impl AsRef<str>,
        schema_version: u32,
        config: Value,
    ) -> Result<Self, ConfigError> {
        let id = NodeId::new(id)?;
        let name = name.into();
        validate_name(&name)?;
        Ok(Self {
            id,
            name,
            driver: DriverId::new(driver),
            schema_version,
            config,
            enabled: true,
            capability_endpoint_id: None,
            children: Vec::new(),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTreeDocument {
    pub schema_version: u32,
    pub root: NodeDecl,
}

impl DeviceTreeDocument {
    pub const fn new(root: NodeDecl) -> Self {
        Self {
            schema_version: DEVICE_TREE_SCHEMA_VERSION,
            root,
        }
    }

    pub fn paths(&self) -> Result<BTreeMap<NodeId, NodePath>, ConfigError> {
        let mut paths = BTreeMap::new();
        collect_paths(&self.root, None, &mut paths)?;
        Ok(paths)
    }

    pub fn node_ids(&self) -> Vec<NodeId> {
        let mut ids = Vec::new();
        collect_ids(&self.root, &mut ids);
        ids
    }
}

fn collect_paths(
    node: &NodeDecl,
    parent: Option<&NodePath>,
    output: &mut BTreeMap<NodeId, NodePath>,
) -> Result<NodePath, ConfigError> {
    validate_name(&node.name)?;
    if output.contains_key(&node.id) {
        return Err(ConfigError::DuplicateNodeId {
            node_id: node.id.clone(),
        });
    }
    let path = match parent {
        Some(parent) => parent.child(&node.name)?,
        None => NodePath::root(&node.name)?,
    };
    output.insert(node.id.clone(), path.clone());
    let mut sibling_names = BTreeSet::new();
    for child in &node.children {
        validate_name(&child.name)?;
        if !sibling_names.insert(child.name.clone()) {
            return Err(ConfigError::DuplicateSiblingName {
                parent_path: path.to_string(),
                name: child.name.clone(),
            });
        }
        collect_paths(child, Some(&path), output)?;
    }
    Ok(path)
}

fn collect_ids(node: &NodeDecl, output: &mut Vec<NodeId>) {
    output.push(node.id.clone());
    for child in &node.children {
        collect_ids(child, output);
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
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

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
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
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeIssue {
    pub error_kind: String,
    pub detail: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
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
