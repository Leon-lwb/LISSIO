//! Persisted device-tree declarations.

use super::DEVICE_TREE_SCHEMA_VERSION;
use super::error::ConfigError;
use super::identity::{DriverId, NodeId, NodePath, validate_name};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct NodeDecl {
    pub id: NodeId,
    pub name: String,
    pub driver: DriverId,
    pub schema_version: u32,
    #[ts(type = "unknown")]
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ts_rs::TS)]
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
