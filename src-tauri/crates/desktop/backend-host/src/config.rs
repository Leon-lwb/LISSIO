//! 应用配置目录解析与历史标识迁移 — 无 Tauri 版本。
//!
//! 无界面 CLI 与 Tauri 组合根读取同一份 `workspace.json` / `recordings/`,
//! 因此目录解析必须与 Tauri `app_config_dir()` 的平台语义保持一致。

use std::path::{Path, PathBuf};

/// 当前应用标识 (与 `tauri.conf.json` 的 `identifier` 一致)。
pub const APP_IDENTIFIER: &str = "top.pengheng.lissio";
/// 覆盖配置目录的环境变量。
pub const CONFIG_DIR_ENV: &str = "LISSIO_CONFIG_DIR";

/// 迁移来源的历史应用标识。
const LEGACY_IDENTIFIER: &str = "top.pengheng.vofa-next";
/// 迁移覆盖的状态文件。
const FILES: [&str; 4] = [
    "settings.json",
    "workspace.json",
    "ai_chat_sessions.json",
    "mcp_servers.json",
];

/// 解析配置目录 — 优先级: 显式参数 > [`CONFIG_DIR_ENV`] > 平台默认。
///
/// 平台默认与 Tauri 一致: macOS `~/Library/Application Support/<identifier>`,
/// Windows `%APPDATA%\<identifier>`, 其他 `$XDG_CONFIG_HOME`/`~/.config/<identifier>`。
pub fn resolve_config_dir(explicit: Option<PathBuf>) -> PathBuf {
    if let Some(dir) = explicit {
        return dir;
    }
    if let Ok(dir) = std::env::var(CONFIG_DIR_ENV)
        && !dir.trim().is_empty()
    {
        return PathBuf::from(dir);
    }
    platform_config_dir()
}

/// 平台默认配置目录 (不含显式参数与环境变量覆盖)。
pub fn platform_config_dir() -> PathBuf {
    home_dir().map_or_else(
        || PathBuf::from(".").join(APP_IDENTIFIER),
        |home| {
            #[cfg(target_os = "macos")]
            let base = home.join("Library").join("Application Support");
            #[cfg(target_os = "windows")]
            let base = std::env::var_os("APPDATA")
                .map_or_else(|| home.join("AppData").join("Roaming"), PathBuf::from);
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let base = std::env::var_os("XDG_CONFIG_HOME")
                .map_or_else(|| home.join(".config"), PathBuf::from);
            base.join(APP_IDENTIFIER)
        },
    )
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

/// 把历史标识目录下的状态文件非破坏性复制到当前配置目录。
///
/// 旧目录永不被修改; 各文件独立判断 (目标已存在则跳过), 因此部分复制后可重试。
pub fn migrate_legacy_config(target: &Path) -> std::io::Result<Vec<String>> {
    std::fs::create_dir_all(target)?;
    let Some(parent) = target.parent() else {
        return Ok(Vec::new());
    };
    let legacy = parent.join(LEGACY_IDENTIFIER);
    if legacy == target || !legacy.is_dir() {
        return Ok(Vec::new());
    }

    let mut migrated = Vec::new();
    for file_name in FILES {
        let source = legacy.join(file_name);
        let destination = target.join(file_name);
        if source.is_file() && !destination.exists() {
            std::fs::copy(&source, &destination)?;
            migrated.push(file_name.to_owned());
        }
    }
    Ok(migrated)
}
