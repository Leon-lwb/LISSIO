//! `SessionStore` — 全部对话会话的内存 + 磁盘所有者。
//!
//! 变更在锁内生效后立即落盘;落盘用「同目录临时文件 + rename」原子替换
//! (见 [`crate::persistence`]), 因此进程被杀不会留下截断的会话文件。网络 IO
//! 与文件锁均不引入 (与 `McpManager` 同一并发模型)。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use error::AiError;
use error::Result;
use parking_lot::Mutex;

use crate::types::{ChatSession, SessionMeta, ViewItemDto, ViewRoleDto};
use data_model::now_ms;

pub use crate::persistence::{
    CONFIG_FILE_NAME, config_path, load_sessions, quarantine_sessions_file, save_sessions,
};

/// 会话存储 — 全部对话会话的内存 + 磁盘所有者。
///
/// 变更在锁内生效后立即落盘;网络 IO 与文件锁均不引入
/// (与 `McpManager` 同一并发模型)。
pub struct SessionStore {
    dir: PathBuf,
    inner: Mutex<Vec<ChatSession>>,
    seq: AtomicU64,
}

impl SessionStore {
    /// 从 app config dir 构造 (加载已有会话)。
    ///
    /// # Errors
    /// 文件存在但损坏时返回 [`AiError::Persist`]。
    pub fn load(dir: &Path) -> Result<Self> {
        Ok(Self {
            dir: dir.to_path_buf(),
            inner: Mutex::new(load_sessions(dir)?),
            seq: AtomicU64::new(0),
        })
    }

    /// 生产入口: 加载会话;损坏文件先隔离再按空会话启动。
    ///
    /// 与 [`SessionStore::load`] 的区别是损坏文件改名保留到
    /// `ai_chat_sessions.corrupt-<unix_ms>.json`, 而不是只报错丢弃 —
    /// 之后的落盘不会覆盖唯一副本。文件缺失仍是「空会话, 无错误」。
    pub fn load_or_quarantine(dir: &Path) -> Self {
        match Self::load(dir) {
            Ok(store) => store,
            Err(error) => {
                match quarantine_sessions_file(dir) {
                    Ok(path) => log::warn!(
                        "AI 会话文件损坏, 已隔离为 {} 并按空会话启动: {error}",
                        path.display()
                    ),
                    Err(quarantine_error) => log::warn!(
                        "AI 会话文件损坏且隔离失败, 按空会话启动: {error}; 隔离失败: {quarantine_error}"
                    ),
                }
                Self::empty(dir)
            }
        }
    }

    /// 空存储构造 (配置损坏或首次启动时的降级形态)。
    pub fn empty(dir: &Path) -> Self {
        Self {
            dir: dir.to_path_buf(),
            inner: Mutex::new(Vec::new()),
            seq: AtomicU64::new(0),
        }
    }

    /// 落盘当前列表。
    fn persist(&self, sessions: &[ChatSession]) -> Result<()> {
        save_sessions(&self.dir, sessions)
    }

    /// 全部会话摘要 (按存储顺序)。
    pub fn list_metas(&self) -> Vec<SessionMeta> {
        self.inner
            .lock()
            .iter()
            .map(|s| SessionMeta {
                id: s.id.clone(),
                title: s.title.clone(),
                created_at: s.created_at,
                updated_at: s.updated_at,
                item_count: s.items.len(),
            })
            .collect()
    }

    /// 读取单个会话 (含全部条目)。
    pub fn get(&self, session_id: &str) -> Option<ChatSession> {
        self.inner
            .lock()
            .iter()
            .find(|s| s.id == session_id)
            .cloned()
    }

    /// 新建会话。
    ///
    /// # Errors
    /// 落盘失败返回 [`AiError::Persist`]。
    pub fn create(&self, title: &str) -> Result<ChatSession> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let id = format!(
            "sess-{nanos:x}-{:x}",
            self.seq.fetch_add(1, Ordering::Relaxed)
        );
        let now = now_ms();
        let session = ChatSession {
            id,
            title: title.to_string(),
            created_at: now,
            updated_at: now,
            items: Vec::new(),
        };
        let mut sessions = self.inner.lock();
        sessions.push(session.clone());
        self.persist(&sessions)?;
        Ok(session)
    }

    /// 重命名会话。
    ///
    /// # Errors
    /// 会话不存在 ([`AiError::UnknownSession`]) 或落盘失败。
    pub fn rename(&self, session_id: &str, title: &str) -> Result<()> {
        let mut sessions = self.inner.lock();
        let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) else {
            return Err(AiError::UnknownSession {
                id: session_id.to_string(),
            }
            .into());
        };
        session.title = title.to_string();
        self.persist(&sessions)
    }

    /// 仅当标题仍为预期值时重命名，避免自动命名覆盖用户手动修改。
    ///
    /// # Errors
    /// 会话不存在或落盘失败。
    pub fn rename_if_matches(&self, session_id: &str, expected: &str, title: &str) -> Result<bool> {
        let mut sessions = self.inner.lock();
        let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) else {
            return Err(AiError::UnknownSession {
                id: session_id.to_string(),
            }
            .into());
        };
        if session.title != expected {
            return Ok(false);
        }
        session.title = title.to_string();
        self.persist(&sessions)?;
        Ok(true)
    }

    /// 删除会话 (不存在时静默)。
    ///
    /// # Errors
    /// 落盘失败返回 [`AiError::Persist`]。
    pub fn remove(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.inner.lock();
        let before = sessions.len();
        sessions.retain(|s| s.id != session_id);
        if sessions.len() == before {
            return Ok(());
        }
        self.persist(&sessions)
    }

    /// 清空会话条目 (保留会话本身;不存在时静默)。
    ///
    /// # Errors
    /// 落盘失败返回 [`AiError::Persist`]。
    pub fn clear_items(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.inner.lock();
        let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) else {
            return Ok(());
        };
        session.items.clear();
        session.updated_at = now_ms();
        self.persist(&sessions)
    }

    /// 追加视图条目 (对话回合产物) 并刷新活动时间。
    /// 会话已被删除时静默丢弃 (流式中途删会话不复活数据)。
    ///
    /// # Errors
    /// 落盘失败返回 [`AiError::Persist`]。
    pub fn append_items(&self, session_id: &str, items: Vec<ViewItemDto>) -> Result<()> {
        if items.is_empty() {
            return Ok(());
        }
        let mut sessions = self.inner.lock();
        let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) else {
            log::debug!("会话 {session_id} 已删除, 丢弃 {} 条条目", items.len());
            return Ok(());
        };
        session.updated_at = now_ms();
        session.items.extend(items);
        self.persist(&sessions)
    }

    /// 用当前回合快照覆盖会话尾部: 截掉最后一条用户条目之后的全部条目, 再追加
    /// `items`。供流式中途反复调用 — 每次写入替换上一次的草稿, 回合收束时的终态
    /// 写入不会留下重复条目。
    ///
    /// 会话不存在时静默丢弃;会话没有用户条目时只能退化为「直接追加」, 该形态只在
    /// 终态写入一次 (中途落盘由调用方按锚点存在与否决定)。空 `items` 不写入。
    ///
    /// # Errors
    /// 落盘失败返回 [`AiError::Persist`]。
    pub fn upsert_turn_items(&self, session_id: &str, items: Vec<ViewItemDto>) -> Result<()> {
        if items.is_empty() {
            return Ok(());
        }
        let mut sessions = self.inner.lock();
        let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) else {
            log::debug!("会话 {session_id} 已删除, 丢弃 {} 条回合条目", items.len());
            return Ok(());
        };
        if let Some(pos) = session
            .items
            .iter()
            .rposition(|item| item.role == ViewRoleDto::User)
        {
            session.items.truncate(pos + 1);
        }
        session.updated_at = now_ms();
        session.items.extend(items);
        self.persist(&sessions)
    }

    /// 截掉最后一条用户条目之后的全部条目 (重新生成前清理)。
    /// 不存在用户条目或会话缺失时不做任何修改。
    ///
    /// # Errors
    /// 落盘失败返回 [`AiError::Persist`]。
    pub fn truncate_after_last_user(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.inner.lock();
        let Some(session) = sessions.iter_mut().find(|s| s.id == session_id) else {
            return Ok(());
        };
        if let Some(pos) = session
            .items
            .iter()
            .rposition(|item| item.role == ViewRoleDto::User)
        {
            session.items.truncate(pos + 1);
            session.updated_at = now_ms();
            self.persist(&sessions)?;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
