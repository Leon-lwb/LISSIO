//! 会话文件 IO — 全量 JSON 读写、原子替换与损坏隔离。
//!
//! 写入形态是「同目录临时文件 → fsync → rename 覆盖」:rename 在同一文件系统内
//! 是原子替换, 因此进程在写中途被杀时目标文件只会是「上一次的完整内容」, 不会
//! 留下截断的 JSON。解析失败的旧文件由 [`quarantine_sessions_file`] 改名保留,
//! 调用方在干净路径上按空会话启动, 绝不静默覆盖唯一副本。

use data_model::now_ms;
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
#[path = "persistence_tests.rs"]
mod tests;
