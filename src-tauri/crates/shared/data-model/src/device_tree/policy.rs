//! Child composition rules for device-tree drivers.

use super::error::ConfigError;
use super::identity::NodeId;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum NodeRole {
    Bus,
    Protocol,
    Endpoint,
    Virtual,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
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
        children: &[super::decl::NodeDecl],
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
