//! Shared Desktop/Web settings persistence, exposed by `/api/v1/settings`.
//! The current document shape is `{ "app": { ... } }`.
//!
//! 写入用"临时文件 + rename"落盘: 就地截断写会让并发读到的内容变成半截 JSON。
//!
//! 本模块同时是**无界面出口回放用户设置**的唯一入口: 装配期读一次
//! [`SettingsStore::recording_enabled`], 桌面 / server / CLI 三出口行为一致。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{Map, Value};

// SettingsStore values are short-lived; serialize replacement across all instances.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Shared settings filename.
pub const SETTINGS_FILE_NAME: &str = "settings.json";

/// Settings document root key.
pub const SETTINGS_KEY: &str = "app";

/// 录制数据库总开关的默认值 — 开启必须是用户显式选择。
pub const RECORDING_ENABLED_DEFAULT: bool = false;

/// 配置目录下 `settings.json` 的读写。
pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    /// 指向 `config_dir/settings.json`。
    #[must_use]
    pub fn new(config_dir: &Path) -> Self {
        Self {
            path: config_dir.join(SETTINGS_FILE_NAME),
        }
    }

    /// 设置文件路径 (诊断用)。
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 读取整个文档。
    ///
    /// Only a missing file returns an empty document. Corrupt or unreadable files
    /// are errors, so clients cannot mistake them for a fresh installation.
    ///
    /// # Errors
    /// 文件存在但读取失败 (权限 / IO) 时返回原因。
    pub fn read(&self) -> Result<Map<String, Value>, String> {
        let text = match std::fs::read_to_string(&self.path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Map::new());
            }
            Err(error) => {
                return Err(format!("读取 {} 失败: {error}", self.path.display()));
            }
        };
        let value = serde_json::from_str::<Value>(&text)
            .map_err(|error| format!("解析 {} 失败: {error}", self.path.display()))?;
        let Value::Object(document) = value else {
            return Err(format!("设置文件 {} 必须是 JSON 对象", self.path.display()));
        };
        Ok(document)
    }

    /// 录制数据库总开关 — 读 `app.data.recordingEnabled`, 缺失或类型不对时回落
    /// [`RECORDING_ENABLED_DEFAULT`]。
    ///
    /// 读取失败同样回落默认值: 读不到设置就是默认关闭, 绝不擅自开始录制。
    #[must_use]
    pub fn recording_enabled(&self) -> bool {
        self.read()
            .ok()
            .and_then(|document| {
                document
                    .get(SETTINGS_KEY)?
                    .get("data")?
                    .get("recordingEnabled")?
                    .as_bool()
            })
            .unwrap_or(RECORDING_ENABLED_DEFAULT)
    }

    /// 原子写入整个文档 (临时文件 + rename)。
    ///
    /// # Errors
    /// 目录不可创建或写入失败时返回原因。
    pub fn write(&self, document: &Map<String, Value>) -> Result<(), String> {
        let _guard = WRITE_LOCK
            .lock()
            .map_err(|error| format!("设置写入锁不可用: {error}"))?;
        if let Some(parent) = self.path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建配置目录 {} 失败: {error}", parent.display()))?;
        }
        let text = serde_json::to_string_pretty(document)
            .map_err(|error| format!("序列化设置失败: {error}"))?;
        let tmp = self.path.with_extension("json.tmp");
        let write_result = (|| {
            use std::io::Write;
            let mut file = std::fs::File::create(&tmp)?;
            file.write_all(text.as_bytes())?;
            file.sync_all()
        })();
        if let Err(error) = write_result {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("写入 {} 失败: {error}", tmp.display()));
        }
        std::fs::rename(&tmp, &self.path).map_err(|error| {
            // 失败时清掉临时文件, 不留垃圾
            let _ = std::fs::remove_file(&tmp);
            format!("替换 {} 失败: {error}", self.path.display())
        })
    }
}

#[cfg(test)]
#[path = "settings_tests.rs"]
mod tests;
