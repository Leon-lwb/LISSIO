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

use crate::persistence::now_ms;
use crate::types::{ChatSession, SessionMeta, ViewItemDto, ViewRoleDto};

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
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("lissio-ai-session-{tag}-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        dir
    }

    fn user_item(text: &str) -> ViewItemDto {
        ViewItemDto {
            role: ViewRoleDto::User,
            text: text.to_string(),
            attachments: None,
            tools: None,
            timeline: None,
            reasoning: None,
            duration_ms: None,
            error: None,
            error_kind: None,
            error_data: None,
        }
    }

    fn assistant_item(text: &str) -> ViewItemDto {
        ViewItemDto {
            role: ViewRoleDto::Assistant,
            text: text.to_string(),
            attachments: None,
            tools: None,
            timeline: None,
            reasoning: None,
            duration_ms: None,
            error: None,
            error_kind: None,
            error_data: None,
        }
    }

    #[test]
    fn store_create_append_and_meta() {
        let dir = temp_dir("store");
        let store = SessionStore::empty(&dir);

        let session = store.create("新会话").expect("新建会话");
        store
            .append_items(&session.id, vec![user_item("hi"), assistant_item("hello")])
            .expect("追加条目");

        let metas = store.list_metas();
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].title, "新会话");
        assert_eq!(metas[0].item_count, 2);

        let loaded = store.get(&session.id).expect("读取会话");
        assert_eq!(loaded.items.len(), 2);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn store_rename_remove_clear_truncate() {
        let dir = temp_dir("mutate");
        let store = SessionStore::empty(&dir);
        let s1 = store.create("a").expect("新建");
        let s2 = store.create("b").expect("新建");
        store
            .append_items(
                &s1.id,
                vec![user_item("hi"), assistant_item("x"), assistant_item("y")],
            )
            .expect("追加");

        store.rename(&s1.id, "改名").expect("重命名");
        assert_eq!(store.get(&s1.id).unwrap().title, "改名");
        assert!(store.rename("nope", "x").is_err(), "未知会话应报错");

        store.truncate_after_last_user(&s1.id).expect("截断");
        assert_eq!(store.get(&s1.id).unwrap().items.len(), 1);

        store.clear_items(&s1.id).expect("清空");
        assert_eq!(store.get(&s1.id).unwrap().items, []);

        store.remove(&s2.id).expect("删除");
        assert!(store.get(&s2.id).is_none());
        // 静默语义: 重复删除 / 对缺失会话追加与清空都不报错
        store.remove(&s2.id).expect("重复删除静默");
        store
            .append_items(&s2.id, vec![user_item("hi")])
            .expect("缺失会话追加静默");
        store.clear_items(&s2.id).expect("缺失会话清空静默");

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 反复写入回合草稿只保留最后一份 (中途快照不重复), 终态写入替换草稿。
    #[test]
    fn upsert_turn_replaces_draft_tail() {
        let dir = temp_dir("upsert");
        let store = SessionStore::empty(&dir);
        let session = store.create("会话").expect("新建");
        store
            .append_items(&session.id, vec![user_item("问")])
            .expect("追加用户条目");

        store
            .upsert_turn_items(&session.id, vec![assistant_item("部分")])
            .expect("首次草稿");
        store
            .upsert_turn_items(&session.id, vec![assistant_item("部分回答")])
            .expect("覆盖草稿");
        store
            .upsert_turn_items(
                &session.id,
                vec![assistant_item("部分回答"), assistant_item("错误")],
            )
            .expect("终态写入");

        let items = store.get(&session.id).unwrap().items;
        assert_eq!(items.len(), 3, "用户条目 + 终态两条");
        assert_eq!(items[1].text, "部分回答");
        assert_eq!(items[2].text, "错误");

        // 磁盘上的内容与内存一致 (草稿已被替换而非叠加)
        let reloaded = SessionStore::load(&dir).expect("重新加载");
        assert_eq!(reloaded.get(&session.id).unwrap().items, items);

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 空快照与缺失会话都是静默空操作, 不写盘也不报错。
    #[test]
    fn upsert_turn_is_silent_without_anchor_or_session() {
        let dir = temp_dir("upsert-empty");
        let store = SessionStore::empty(&dir);
        let session = store.create("会话").expect("新建");
        store
            .append_items(&session.id, vec![user_item("问"), assistant_item("答")])
            .expect("追加");

        store
            .upsert_turn_items(&session.id, Vec::new())
            .expect("空快照静默");
        store
            .upsert_turn_items("missing", vec![assistant_item("x")])
            .expect("缺失会话静默");
        assert_eq!(store.get(&session.id).unwrap().items.len(), 2);

        // 没有用户条目的会话退化为追加 (仅终态调用一次)
        let bare = store.create("裸会话").expect("新建");
        store
            .upsert_turn_items(&bare.id, vec![assistant_item("独答")])
            .expect("无锚点追加");
        assert_eq!(store.get(&bare.id).unwrap().items.len(), 1);

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 损坏文件被隔离保留, 存储按空会话启动且随后可正常落盘。
    #[test]
    fn load_or_quarantine_keeps_corrupt_file() {
        let dir = temp_dir("quarantine");
        std::fs::create_dir_all(&dir).expect("建目录");
        std::fs::write(config_path(&dir), "{ not json").expect("写坏文件");

        let store = SessionStore::load_or_quarantine(&dir);
        assert!(store.list_metas().is_empty(), "损坏文件按空会话启动");
        assert!(!config_path(&dir).exists(), "坏文件已改名");

        let quarantined: Vec<PathBuf> = std::fs::read_dir(&dir)
            .expect("列目录")
            .filter_map(std::result::Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name().is_some_and(|name| {
                    name.to_string_lossy()
                        .starts_with("ai_chat_sessions.corrupt-")
                })
            })
            .collect();
        assert_eq!(quarantined.len(), 1, "隔离文件唯一");
        assert_eq!(
            std::fs::read_to_string(&quarantined[0]).expect("读隔离文件"),
            "{ not json"
        );

        // 隔离后新建会话会写回干净文件, 不再触碰隔离副本
        store.create("新会话").expect("新建会话");
        assert_eq!(
            SessionStore::load(&dir)
                .expect("重新加载")
                .list_metas()
                .len(),
            1
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// 文件缺失不是损坏: 空会话启动且不产生隔离文件。
    #[test]
    fn load_or_quarantine_missing_file_is_empty() {
        let dir = temp_dir("quarantine-missing");
        let store = SessionStore::load_or_quarantine(&dir);
        assert!(store.list_metas().is_empty());
        assert!(!dir.exists(), "不应为缺失文件创建目录或隔离副本");

        std::fs::remove_dir_all(&dir).ok();
    }
}
