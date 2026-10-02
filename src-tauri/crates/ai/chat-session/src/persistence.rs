//! 会话文件 IO — 全量 JSON 读写、原子替换与损坏隔离。
//!
//! 写入形态是「同目录临时文件 → fsync → rename 覆盖」:rename 在同一文件系统内
//! 是原子替换, 因此进程在写中途被杀时目标文件只会是「上一次的完整内容」, 不会
//! 留下截断的 JSON。解析失败的旧文件由 [`quarantine_sessions_file`] 改名保留,
//! 调用方在干净路径上按空会话启动, 绝不静默覆盖唯一副本。

use std::fs::{self, File};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use error::AiError;
use error::Result;
use serde::{Deserialize, Serialize};

use crate::types::ChatSession;

/// 会话文件名 (位于 app config dir)。
pub const CONFIG_FILE_NAME: &str = "ai_chat_sessions.json";

/// 损坏文件改名后的前缀 — 与 [`CONFIG_FILE_NAME`] 词干一致。
const CORRUPT_STEM: &str = "ai_chat_sessions";

/// 同进程内临时文件名序号 (并发写入不撞名)。
static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// 落盘文档 — 会话文件只有这一个字段, 缺失即视为损坏 (由调用方隔离)。
#[derive(Debug, Default, Serialize, Deserialize)]
struct SessionsFile {
    sessions: Vec<ChatSession>,
}

/// 会话文件完整路径。
pub fn config_path(dir: &Path) -> PathBuf {
    dir.join(CONFIG_FILE_NAME)
}

/// 当前 unix 毫秒时间戳。
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or_default())
}

/// 读取全部会话;文件不存在视为空列表。
///
/// # Errors
/// 文件存在但读取或解析失败时返回 [`AiError::Persist`]。
pub fn load_sessions(dir: &Path) -> Result<Vec<ChatSession>> {
    let path = config_path(dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|source| AiError::Persist { source })?;
    let file = serde_json::from_str::<SessionsFile>(&text).map_err(|source| AiError::Persist {
        source: std::io::Error::other(source.to_string()),
    })?;
    Ok(file.sessions)
}

/// 写入全部会话 (全量覆盖, 原子替换)。
///
/// # Errors
/// 序列化或写文件失败时返回 [`AiError::Persist`];写失败时目标文件保持原内容。
pub fn save_sessions(dir: &Path, sessions: &[ChatSession]) -> Result<()> {
    let path = config_path(dir);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| AiError::Persist { source })?;
    }
    let file = SessionsFile {
        sessions: sessions.to_vec(),
    };
    let text = serde_json::to_string_pretty(&file).map_err(|source| AiError::Persist {
        source: std::io::Error::other(source.to_string()),
    })?;
    write_atomic(&path, text.as_bytes())
}

/// 隔离解析失败的会话文件 — 原名改到 `ai_chat_sessions.corrupt-<unix_ms>.json`,
/// 字节原样保留, 让调用方在干净路径上按空会话启动。
///
/// # Errors
/// 源文件不存在或改名失败时返回 [`AiError::Persist`]。
pub fn quarantine_sessions_file(dir: &Path) -> Result<PathBuf> {
    let path = config_path(dir);
    let backup = dir.join(format!("{CORRUPT_STEM}.corrupt-{}.json", now_ms()));
    fs::rename(&path, &backup).map_err(|source| AiError::Persist { source })?;
    Ok(backup)
}

/// 原子替换写入: 同目录临时文件 → 写入 → `fsync` → `rename` 覆盖目标。
///
/// 任何一步失败都会删掉临时文件并保留目标原内容;成功后临时文件已被 rename 消费。
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = temp_path(path);
    let result = File::create(&tmp).and_then(|mut file| {
        file.write_all(bytes)?;
        // 数据落盘后再 rename, 崩溃重放时目标不会指向空文件
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, path)
    });
    if let Err(source) = result {
        let _ = fs::remove_file(&tmp);
        return Err(AiError::Persist { source }.into());
    }
    Ok(())
}

/// 同目录唯一临时文件路径 — 必须与目标同文件系统, rename 才是原子替换。
fn temp_path(path: &Path) -> PathBuf {
    let stem = path.file_name().map_or_else(
        || CORRUPT_STEM.to_string(),
        |name| name.to_string_lossy().into_owned(),
    );
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    path.with_file_name(format!("{stem}.{}-{seq}.tmp", std::process::id()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ToolRunDto, TurnEventDto, ViewItemDto, ViewRoleDto};
    use serde_json::json;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "lissio-ai-session-file-{tag}-{}",
            std::process::id()
        ));
        fs::remove_dir_all(&dir).ok();
        dir
    }

    fn session(id: &str) -> ChatSession {
        ChatSession {
            id: id.to_string(),
            title: "会话".to_string(),
            created_at: 1,
            updated_at: 2,
            items: vec![ViewItemDto {
                role: ViewRoleDto::User,
                text: id.to_string(),
                attachments: None,
                tools: None,
                timeline: None,
                reasoning: None,
                duration_ms: None,
                error: None,
                error_kind: None,
                error_data: None,
            }],
        }
    }

    /// 完整条目 (工具卡片 / 时间线 / 推理) 写入后原样读回。
    #[test]
    fn roundtrip_sessions_file() {
        let dir = temp_dir("roundtrip");
        let session = ChatSession {
            id: "s1".to_string(),
            title: "调试".to_string(),
            created_at: 1,
            updated_at: 2,
            items: vec![
                ViewItemDto {
                    role: ViewRoleDto::User,
                    text: "你好".to_string(),
                    attachments: None,
                    tools: None,
                    timeline: None,
                    reasoning: None,
                    duration_ms: None,
                    error: None,
                    error_kind: None,
                    error_data: None,
                },
                ViewItemDto {
                    role: ViewRoleDto::Assistant,
                    text: "回答".to_string(),
                    attachments: None,
                    tools: Some(vec![ToolRunDto {
                        id: "c1".to_string(),
                        name: "probe".to_string(),
                        arguments: json!({"value": 7}),
                        text_offset: 0,
                        content: "42".to_string(),
                        is_error: false,
                        done: true,
                    }]),
                    timeline: Some(vec![
                        TurnEventDto::Tool {
                            id: "c1".to_string(),
                        },
                        TurnEventDto::Text {
                            text: "回答".to_string(),
                        },
                    ]),
                    reasoning: Some("正在分析".to_string()),
                    duration_ms: Some(812),
                    error: None,
                    error_kind: None,
                    error_data: None,
                },
            ],
        };

        save_sessions(&dir, std::slice::from_ref(&session)).expect("保存会话");
        let loaded = load_sessions(&dir).expect("读取会话");
        assert_eq!(loaded, vec![session]);

        fs::remove_dir_all(&dir).ok();
    }

    /// 不存在的目录读取返回空列表 (首次启动零会话)。
    #[test]
    fn missing_file_is_empty() {
        let dir = temp_dir("missing");
        let loaded = load_sessions(&dir).expect("缺失文件应视为空");
        assert_eq!(loaded, []);
    }

    /// 损坏的会话文件 → 读取报 Persist 错误 (由调用方决定隔离)。
    #[test]
    fn corrupt_file_errors() {
        let dir = temp_dir("corrupt");
        fs::create_dir_all(&dir).expect("建目录");
        fs::write(config_path(&dir), "{ not json").expect("写坏文件");

        assert!(load_sessions(&dir).is_err());

        fs::remove_dir_all(&dir).ok();
    }

    /// 用例结束恢复目录权限, 断言 panic 也能清理。
    struct RestorePermissions(PathBuf, fs::Permissions);
    impl Drop for RestorePermissions {
        fn drop(&mut self) {
            let _ = fs::set_permissions(&self.0, self.1.clone());
        }
    }

    fn temp_leftovers(dir: &Path) -> Vec<String> {
        fs::read_dir(dir)
            .map(|entries| {
                entries
                    .filter_map(std::result::Result::ok)
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .filter(|name| {
                        std::path::Path::new(name)
                            .extension()
                            .is_some_and(|e| e == "tmp")
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// 反复覆盖写不残留临时文件, 内容始终可读。
    #[test]
    fn atomic_save_leaves_no_temp_files() {
        let dir = temp_dir("atomic");
        save_sessions(&dir, &[session("s1")]).expect("首次落盘");
        save_sessions(&dir, &[session("s1"), session("s2")]).expect("覆盖落盘");

        assert!(temp_leftovers(&dir).is_empty(), "残留临时文件");
        let loaded = load_sessions(&dir).expect("读取会话");
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[1].id, "s2");

        fs::remove_dir_all(&dir).ok();
    }

    /// 写失败时目标文件保持上一次的完整内容, 且不残留临时文件。
    ///
    /// 序列化本身在当前 DTO 上不可能失败, 因此用只读目录制造写入失败;
    /// 文件系统不拒绝写入时 (root / 不认只读位的平台) 跳过。
    #[test]
    fn failed_write_keeps_previous_content() {
        let dir = temp_dir("readonly");
        save_sessions(&dir, &[session("keep")]).expect("准备旧内容");

        let original = fs::metadata(&dir).expect("读目录权限").permissions();
        let mut readonly = original.clone();
        readonly.set_readonly(true);
        fs::set_permissions(&dir, readonly).expect("置只读");
        let _restore = RestorePermissions(dir.clone(), original);

        if File::create(dir.join(".writable-probe")).is_ok() {
            // 该文件系统不拒绝写入 (root / 平台差异), 本用例不适用
            fs::remove_file(dir.join(".writable-probe")).ok();
            fs::remove_dir_all(&dir).ok();
            return;
        }

        assert!(
            save_sessions(&dir, &[session("replaced")]).is_err(),
            "只读目录写入应失败"
        );
        let loaded = load_sessions(&dir).expect("旧内容仍可读");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "keep");

        fs::remove_dir_all(&dir).ok();
    }

    /// rename 失败时临时文件被清理 (写入已成功, 失败点在最后一步替换)。
    #[test]
    fn failed_rename_cleans_temp_file() {
        let dir = temp_dir("rename-fail");
        fs::create_dir_all(&dir).expect("建目录");
        // 目标路径占位为目录 → rename(文件 → 目录) 必然失败
        fs::create_dir_all(config_path(&dir)).expect("目标位置占位为目录");

        assert!(save_sessions(&dir, &[session("s1")]).is_err(), "替换应失败");
        assert!(temp_leftovers(&dir).is_empty(), "临时文件应被清理");

        fs::remove_dir_all(&dir).ok();
    }

    /// 隔离保留损坏文件的原字节, 并腾出原路径。
    #[test]
    fn quarantine_keeps_corrupt_bytes() {
        let dir = temp_dir("quarantine");
        fs::create_dir_all(&dir).expect("建目录");
        fs::write(config_path(&dir), "{ not json").expect("写坏文件");

        let backup = quarantine_sessions_file(&dir).expect("隔离损坏文件");
        assert!(!config_path(&dir).exists(), "原路径应已腾空");
        let name = backup.file_name().unwrap().to_string_lossy().into_owned();
        assert!(
            name.starts_with("ai_chat_sessions.corrupt-"),
            "命名: {name}"
        );
        assert!(
            Path::new(&name)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("json")),
            "命名: {name}"
        );
        assert_eq!(
            fs::read_to_string(&backup).expect("读隔离文件"),
            "{ not json"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// 文件不存在时隔离失败 (调用方不得把缺失当损坏)。
    #[test]
    fn quarantine_missing_file_errors() {
        let dir = temp_dir("quarantine-missing");
        assert!(quarantine_sessions_file(&dir).is_err());
        assert!(load_sessions(&dir).expect("缺失视为空").is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    /// 缺失 `sessions` 字段的 JSON 视为损坏而不是空列表。
    #[test]
    fn json_without_sessions_field_is_corrupt() {
        let dir = temp_dir("no-field");
        fs::create_dir_all(&dir).expect("建目录");
        fs::write(config_path(&dir), "{}").expect("写文件");
        assert!(load_sessions(&dir).is_err());
        fs::remove_dir_all(&dir).ok();
    }
}
