//! String newtype identities used across the device tree.

use super::error::ConfigError;
use serde::{Deserialize, Serialize};
use std::fmt;

/// Persisted node identity; unique within a workspace's device trees.
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

/// Absolute path of a node inside one device tree (`/root/child`).
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

/// Registry identity of a device-tree driver.
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

pub fn validate_name(name: &str) -> Result<(), ConfigError> {
    if name.trim().is_empty() || name.contains('/') {
        return Err(ConfigError::InvalidNodeName {
            name: name.to_string(),
        });
    }
    Ok(())
}

// 手动 TS 实现: wire 为纯字符串 (serde transparent), derive 会因无法解析
// transparent 属性产生误报警告, 这里直接给出与 wire 一致的 string 投影。
impl ts_rs::TS for NodeId {
    type WithoutGenerics = Self;
    type OptionInnerType = Self;

    fn name(_: &ts_rs::Config) -> String {
        "NodeId".to_owned()
    }

    fn inline(_: &ts_rs::Config) -> String {
        "string".to_owned()
    }

    fn decl(cfg: &ts_rs::Config) -> String {
        format!("type {} = {};", Self::name(cfg), Self::inline(cfg))
    }

    fn output_path() -> Option<std::path::PathBuf> {
        Some("NodeId.ts".into())
    }
}

// 手动 TS 实现: wire 为纯字符串 (serde transparent), derive 会因无法解析
// transparent 属性产生误报警告, 这里直接给出与 wire 一致的 string 投影。
impl ts_rs::TS for NodePath {
    type WithoutGenerics = Self;
    type OptionInnerType = Self;

    fn name(_: &ts_rs::Config) -> String {
        "NodePath".to_owned()
    }

    fn inline(_: &ts_rs::Config) -> String {
        "string".to_owned()
    }

    fn decl(cfg: &ts_rs::Config) -> String {
        format!("type {} = {};", Self::name(cfg), Self::inline(cfg))
    }

    fn output_path() -> Option<std::path::PathBuf> {
        Some("NodePath.ts".into())
    }
}

// 手动 TS 实现: wire 为纯字符串 (serde transparent), derive 会因无法解析
// transparent 属性产生误报警告, 这里直接给出与 wire 一致的 string 投影。
impl ts_rs::TS for DriverId {
    type WithoutGenerics = Self;
    type OptionInnerType = Self;

    fn name(_: &ts_rs::Config) -> String {
        "DriverId".to_owned()
    }

    fn inline(_: &ts_rs::Config) -> String {
        "string".to_owned()
    }

    fn decl(cfg: &ts_rs::Config) -> String {
        format!("type {} = {};", Self::name(cfg), Self::inline(cfg))
    }

    fn output_path() -> Option<std::path::PathBuf> {
        Some("DriverId.ts".into())
    }
}
