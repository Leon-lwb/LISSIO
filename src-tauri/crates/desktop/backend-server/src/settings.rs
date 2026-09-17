//! 设置持久化 — 与桌面 `plugin-store` 的 `settings.json` 同一文件与同一形状。
//!
//! 浏览器端没有 Tauri store, 设置改由服务端持久化 (P3, 见
//! `docs/architecture/web-exit.md` §5.5)。文件形状保持 `{ "app": { ... } }` —
//! 桌面 `LazyStore('settings.json').set('app', …)` 写的就是这个形状, 因此
//! **持久化格式对前端不变**, 桌面与 Web 出口读写同一份设置, 换出口也不需要迁移。
//!
//! 写入用"临时文件 + rename"落盘: 桌面壳可能同时打开同一份文件, 就地截断写会
//! 让并发读到的内容变成半截 JSON。

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

/// 设置文件名 (与桌面 `LazyStore('settings.json')` 一致)。
pub const SETTINGS_FILE_NAME: &str = "settings.json";

/// 设置文档顶层键 (与桌面 `LazyStore` 的 `'app'` 键一致)。
pub const SETTINGS_KEY: &str = "app";

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
    /// 文件不存在、为空或不是 JSON 对象时返回空对象 — 前端据此回落默认设置
    /// (与桌面 `LazyStore.get` 返回 `undefined` 的语义一致), 而不是报错卡住启动。
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
        match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(document)) => Ok(document),
            // 损坏 / 非对象: 按"没有设置"处理, 不用坏数据挡住启动
            Ok(_) | Err(_) => Ok(Map::new()),
        }
    }

    /// 原子写入整个文档 (临时文件 + rename)。
    ///
    /// # Errors
    /// 目录不可创建或写入失败时返回原因。
    pub fn write(&self, document: &Map<String, Value>) -> Result<(), String> {
        if let Some(parent) = self.path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建配置目录 {} 失败: {error}", parent.display()))?;
        }
        let text = serde_json::to_string_pretty(document)
            .map_err(|error| format!("序列化设置失败: {error}"))?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, text)
            .map_err(|error| format!("写入 {} 失败: {error}", tmp.display()))?;
        std::fs::rename(&tmp, &self.path).map_err(|error| {
            // 失败时清掉临时文件, 不留垃圾
            let _ = std::fs::remove_file(&tmp);
            format!("替换 {} 失败: {error}", self.path.display())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{SETTINGS_FILE_NAME, SETTINGS_KEY, SettingsStore};
    use serde_json::{Map, Value, json};

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lissio-settings-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// 缺失文件 = 空文档 (前端回落默认值), 不是错误。
    #[test]
    fn missing_file_reads_as_empty_document() {
        let dir = temp_dir("missing");
        let store = SettingsStore::new(&dir);
        assert!(store.read().expect("缺文件不应报错").is_empty());
        assert_eq!(store.path(), dir.join(SETTINGS_FILE_NAME));
    }

    /// 写入后读回同一形状 — `{ "app": … }`, 与桌面 plugin-store 兼容。
    #[test]
    fn round_trip_preserves_plugin_store_shape() {
        let dir = temp_dir("roundtrip");
        let store = SettingsStore::new(&dir);
        let mut document = Map::new();
        document.insert(
            SETTINGS_KEY.to_string(),
            json!({ "general": { "lang": "zh" } }),
        );

        store.write(&document).expect("写入应成功");
        let raw = std::fs::read_to_string(store.path()).expect("文件应存在");
        let parsed: Value = serde_json::from_str(&raw).expect("应是合法 JSON");
        assert_eq!(parsed["app"]["general"]["lang"], json!("zh"));

        let read_back = store.read().expect("读取应成功");
        assert_eq!(read_back[SETTINGS_KEY], document[SETTINGS_KEY]);
        // 不留临时文件
        assert!(!store.path().with_extension("json.tmp").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 损坏内容按"无设置"处理 — 不让坏文件挡住启动。
    #[test]
    fn corrupt_file_reads_as_empty_document() {
        let dir = temp_dir("corrupt");
        std::fs::create_dir_all(&dir).expect("目录应可创建");
        let store = SettingsStore::new(&dir);
        std::fs::write(store.path(), b"{ not json").expect("写入应成功");
        assert!(store.read().expect("损坏文件不应报错").is_empty());
        // 非对象 JSON 同样按空处理
        std::fs::write(store.path(), b"[1,2,3]").expect("写入应成功");
        assert!(store.read().expect("数组不应报错").is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
