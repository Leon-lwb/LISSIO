//! `mcp_servers.json` 读写 — 配置持久化 (目录由命令层传入)。

use std::fs;
use std::path::{Path, PathBuf};

use error::McpError;
use error::Result;
use serde::{Deserialize, Serialize};

use crate::types::McpServerConfig;

/// 配置文件名 (位于 app config dir)。
pub const CONFIG_FILE_NAME: &str = "mcp_servers.json";

#[derive(Debug, Default, Serialize, Deserialize)]
struct ConfigFile {
    #[serde(default)]
    servers: Vec<McpServerConfig>,
}

/// 配置文件完整路径。
pub fn config_path(dir: &Path) -> PathBuf {
    dir.join(CONFIG_FILE_NAME)
}

/// 读取 server 配置列表;文件不存在视为空列表。
///
/// # Errors
/// 文件存在但解析失败时返回 [`McpError::Persist`]。
pub fn load_servers(dir: &Path) -> Result<Vec<McpServerConfig>> {
    let path = config_path(dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|source| McpError::Persist { source })?;
    let file = serde_json::from_str::<ConfigFile>(&text).map_err(|source| McpError::Persist {
        source: std::io::Error::other(source.to_string()),
    })?;
    Ok(file.servers)
}

/// 写入 server 配置列表 (全量覆盖)。
///
/// # Errors
/// 序列化或写文件失败时返回 [`McpError::Persist`]。
pub fn save_servers(dir: &Path, servers: &[McpServerConfig]) -> Result<()> {
    let path = config_path(dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| McpError::Persist { source })?;
    }
    let file = ConfigFile {
        servers: servers.to_vec(),
    };
    let text = serde_json::to_string_pretty(&file).map_err(|source| McpError::Persist {
        source: std::io::Error::other(source.to_string()),
    })?;
    fs::write(&path, text).map_err(|source| McpError::Persist { source })?;
    Ok(())
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
