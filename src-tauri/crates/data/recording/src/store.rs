use std::path::{Path, PathBuf};
use std::sync::Arc;

use duckdb::{AccessMode, Config, Connection, params};
use serde::{Deserialize, Serialize};

use crate::codec;
use crate::schema::initialize;
use crate::writer::{QueryCancellation, RecordingReader};
use crate::{
    DisplayBinding, Domain, RecordBatch, RecordingError, SessionInfo, SessionState, StoredBatch,
};

#[derive(Debug, Clone)]
pub struct RecordingStore {
    path: PathBuf,
    /// 读路径句柄 — 有它时所有读 (查询 / 导出 / 会话检查) 都在写线程的**唯一**
    /// DuckDB 连接上执行; `None` 表示尚未挂载写线程 (构造期、修复路径、测试直接
    /// 打开), 读退化为独占打开。
    reader: Option<RecordingReader>,
}

/// 写入连接的会话参数。
///
/// `checkpoint_threshold` 决定自动 checkpoint 的触发点 — checkpoint 期间 writer
/// 线程会停顿, 停顿超过队列缓冲就是一次背压。阈值从 256 MiB 提到 1 GiB 是拿
/// 「单次停顿更长」换「停顿更少」, 配合 4096 条的写线程队列 (见
/// [`crate::RecordingLimits`]) 足以吸收一次 checkpoint。
const WRITE_SESSION_PRAGMAS: &str =
    "SET preserve_insertion_order=false; SET threads=4; SET checkpoint_threshold='1 GiB';";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HistoryPage {
    pub rows: Vec<StoredBatch>,
    pub next_row_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SqlResult {
    pub rows: Vec<serde_json::Value>,
    pub truncated: bool,
}

impl RecordingStore {
    /// Open (creating when needed) the database at `path`.
    ///
    /// 打开即校验: 建表后**真读**一遍三张表, 目录损坏时走既有
    /// [`crate::repair::rebuild_database`] 自动重建 (损坏原件留作 `.corrupt-*`
    /// 备份)。重建提示由 [`Self::open_checked`] 返回, 由 hub 写进健康报告 —
    /// 用户看得见「已重建」, 而不是以为历史凭空消失。
    pub fn open(path: impl AsRef<Path>) -> Result<Self, RecordingError> {
        Self::open_checked(path).map(|(store, _rebuilt)| store)
    }

    /// [`Self::open`] 的带提示版本 — `Some` 表示这次打开触发了自动恢复:
    /// 目录损坏时重建 (能读的行搬进新库), 文件级损坏时隔离原件并新建空库。
    pub(crate) fn open_checked(
        path: impl AsRef<Path>,
    ) -> Result<(Self, Option<String>), RecordingError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let store = Self { path, reader: None };
        // 文件级损坏: 连打开都失败, 没有任何内容可以导出。隔离原件、在干净路径上新建
        // 空库 — 否则录制会一直不可用, 而用户只看到一句「writer is closed」。
        let connection = match store.connect() {
            Ok(connection) => connection,
            Err(error) if crate::repair::is_unreadable(&error) => {
                let backup = crate::repair::quarantine_database(store.path())?;
                let connection = store.connect()?;
                initialize(&connection)?;
                mark_orphaned_sessions(&connection)?;
                return Ok((store, Some(quarantined_note(&backup))));
            }
            Err(error) => return Err(error),
        };
        initialize(&connection)?;
        match crate::repair::verify_catalog(&connection) {
            Ok(()) => {
                mark_orphaned_sessions(&connection)?;
                Ok((store, None))
            }
            // 目录损坏: 重建要求没有连接打开, 所以先关掉再走既有修复路径。
            Err(error) if crate::repair::is_catalog_damage(&error) => {
                drop(connection);
                let backup = crate::repair::rebuild_database(store.path())?;
                let connection = store.connect()?;
                initialize(&connection)?;
                mark_orphaned_sessions(&connection)?;
                Ok((store, Some(rebuilt_note(&backup))))
            }
            Err(error) => Err(error),
        }
    }

    /// 挂上读路径句柄 — 由写线程的 channel 提供。
    pub(crate) fn with_reader(mut self, reader: RecordingReader) -> Self {
        self.reader = Some(reader);
        self
    }

    /// 去掉读路径句柄 — 写线程自己用的副本。
    pub(crate) fn without_reader(&self) -> Self {
        Self {
            path: self.path.clone(),
            reader: None,
        }
    }

    pub(crate) const fn reader(&self) -> Option<&RecordingReader> {
        self.reader.as_ref()
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn connect(&self) -> Result<Connection, RecordingError> {
        let connection = Connection::open(&self.path)?;
        connection.execute_batch(WRITE_SESSION_PRAGMAS)?;
        Ok(connection)
    }

    pub(crate) fn connect_read_only(&self) -> Result<Connection, RecordingError> {
        let config = Config::default()
            .access_mode(AccessMode::ReadOnly)?
            .enable_external_access(false)?;
        let connection = Connection::open_with_flags(&self.path, config)?;
        connection.execute_batch("SET threads=4;")?;
        Ok(connection)
    }

    pub(crate) fn create_session(
        &self,
        bindings: &[DisplayBinding],
    ) -> Result<SessionInfo, RecordingError> {
        let connection = self.connect()?;
        let started_at_us = now_us();
        let id = format!("{started_at_us}-{}", std::process::id());
        connection.execute_batch("BEGIN TRANSACTION")?;
        let result = (|| {
            connection.execute(
                "INSERT INTO recording_sessions(id, started_at_us, state) VALUES (?, ?, 'running')",
                params![&id, started_at_us],
            )?;
            for binding in bindings {
                insert_binding(&connection, &id, binding)?;
            }
            connection.execute_batch("COMMIT")?;
            Ok(SessionInfo {
                id,
                started_at_us,
                ended_at_us: None,
                state: SessionState::Running,
            })
        })();
        if result.is_err() {
            let _ = connection.execute_batch("ROLLBACK");
        }
        result
    }

    /// Resume a finished session for further writes: clears the end timestamp
    /// and stores `state`. Only explicitly stopped sessions can be resumed.
    pub(crate) fn reopen_session(
        &self,
        session_id: &str,
        state: SessionState,
    ) -> Result<SessionInfo, RecordingError> {
        let connection = self.connect()?;
        let updated = connection.execute(
            "UPDATE recording_sessions SET state=?, ended_at_us=NULL \
             WHERE id=? AND state='stopped'",
            params![state.as_str(), session_id],
        )?;
        if updated == 0 {
            return Err(RecordingError::Invalid(format!(
                "recording session was not found or is not resumable: {session_id}"
            )));
        }
        Self::list_sessions_on(&connection)?
            .into_iter()
            .find(|session| session.id == session_id)
            .ok_or_else(|| {
                RecordingError::Invalid(format!("recording session was not found: {session_id}"))
            })
    }

    /// Startup continuation probe: returns the newest session's id when it
    /// holds no batches at all. An empty session carries no data to lose
    /// (including one left `failed` by crash recovery), so resuming it keeps
    /// restarts from piling up empty sessions; a session with batches returns
    /// `None` and the caller creates a new one. The empty session is
    /// normalized to `stopped` first so `reopen_session` accepts it.
    pub(crate) fn resumable_empty_session(&self) -> Result<Option<String>, RecordingError> {
        let connection = self.connect()?;
        let latest = match connection.query_row(
            "SELECT id, state FROM recording_sessions ORDER BY started_at_us DESC LIMIT 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        ) {
            Ok(row) => Some(row),
            Err(duckdb::Error::QueryReturnedNoRows) => None,
            Err(error) => return Err(error.into()),
        };
        let Some((id, state)) = latest else {
            return Ok(None);
        };
        if !Self::session_is_empty_on(&connection, &id)? {
            return Ok(None);
        }
        if parse_state(&state) != SessionState::Stopped {
            connection.execute(
                "UPDATE recording_sessions SET state='stopped', ended_at_us=? WHERE id=?",
                params![now_us(), &id],
            )?;
        }
        Ok(Some(id))
    }

    /// Delete one session and its children.
    ///
    /// 有写线程时经它的**唯一**连接执行; 没有时 (库已关闭 / 测试直接打开) 才
    /// 独占打开。运行期删除仍优先走 [`crate::RecordingHub::delete_session`]。
    pub fn delete_session(&self, session_id: &str) -> Result<(), RecordingError> {
        if let Some(reader) = self.reader() {
            return reader.delete_session(session_id);
        }
        Self::delete_session_on(&self.connect()?, session_id)
    }

    pub(crate) fn delete_session_on(
        connection: &Connection,
        session_id: &str,
    ) -> Result<(), RecordingError> {
        let state: String = connection
            .query_row(
                "SELECT state FROM recording_sessions WHERE id=?",
                params![session_id],
                |row| row.get(0),
            )
            .map_err(|error| match error {
                duckdb::Error::QueryReturnedNoRows => {
                    RecordingError::Invalid("recording session was not found".into())
                }
                other => other.into(),
            })?;
        if matches!(
            parse_state(&state),
            SessionState::Running | SessionState::Paused
        ) {
            return Err(RecordingError::Invalid(
                "an active recording session cannot be deleted".into(),
            ));
        }
        // 与 [`crate::maintenance::delete_sessions_on`] 同一条理由: 带索引删批次会把
        // 「索引与表不一致」升级成整个 DatabaseInstance 失效的致命错误, 之后连补救
        // 语句都跑不了。所以先摘时间索引再删行, 删完按剩余行重建 — 重建失败不应盖掉
        // 删除结果, 索引只是查询优化。
        crate::maintenance::drop_time_index(connection)?;
        let result = (|| -> Result<(), RecordingError> {
            connection.execute(
                "DELETE FROM recording_batches WHERE session_id=?",
                params![session_id],
            )?;
            connection.execute(
                "DELETE FROM display_bindings WHERE session_id=?",
                params![session_id],
            )?;
            connection.execute(
                "DELETE FROM recording_sessions WHERE id=?",
                params![session_id],
            )?;
            Ok(())
        })();
        let _ = crate::maintenance::create_time_index(connection);
        result
    }

    /// Run one read-only SELECT and return rows as JSON objects.
    ///
    /// 有写线程时走它的**唯一**连接; 没有时 (构造期 / 测试直接打开) 才独占打开。
    pub fn query_sql(&self, sql: &str, max_rows: usize) -> Result<SqlResult, RecordingError> {
        self.query_sql_cancellable(sql, max_rows, &Arc::new(QueryCancellation::default()))
    }

    /// [`Self::query_sql`] 的带取消槽版本 — hub 用它把 `cancel_query` 接到写线程
    /// 执行中的查询上。
    pub(crate) fn query_sql_cancellable(
        &self,
        sql: &str,
        max_rows: usize,
        cancellation: &Arc<QueryCancellation>,
    ) -> Result<SqlResult, RecordingError> {
        if let Some(reader) = self.reader() {
            return reader.sql(sql.to_string(), max_rows, Arc::clone(cancellation));
        }
        let connection = self.connect()?;
        cancellation.attach(connection.interrupt_handle());
        let result = Self::query_sql_on(&connection, sql, max_rows);
        cancellation.detach();
        result
    }

    pub(crate) fn next_row_id(connection: &Connection) -> Result<i64, RecordingError> {
        let maximum: Option<i64> =
            connection.query_row("SELECT max(row_id) FROM recording_batches", [], |row| {
                row.get(0)
            })?;
        Ok(maximum.unwrap_or(0).saturating_add(1))
    }

    pub(crate) fn insert_binding(
        connection: &Connection,
        session_id: &str,
        binding: &DisplayBinding,
    ) -> Result<(), RecordingError> {
        insert_binding(connection, session_id, binding)
    }

    pub(crate) fn close_binding(
        connection: &Connection,
        session_id: &str,
        binding_id: &str,
    ) -> Result<(), RecordingError> {
        connection.execute(
            "UPDATE display_bindings SET unbound_at_us=? WHERE session_id=? AND id=?",
            params![now_us(), session_id, binding_id],
        )?;
        Ok(())
    }

    pub(crate) fn write_batch(
        connection: &Connection,
        session_id: &str,
        row_id: i64,
        batch: &RecordBatch,
    ) -> Result<usize, RecordingError> {
        crate::model::validate_batch(batch)?;
        let payload = codec::encode(&batch.payload)?;
        let checksum = codec::checksum(&payload);
        let first_timestamp = batch.timestamps_us.first().copied().unwrap_or_default();
        let last_timestamp = batch
            .timestamps_us
            .last()
            .copied()
            .unwrap_or(first_timestamp);
        let effective_bytes = batch.payload.effective_bytes();
        connection.execute(
            "INSERT INTO recording_batches( \
                row_id, session_id, binding_id, domain, epoch, sequence_start, sequence_end, \
                first_timestamp_us, last_timestamp_us, item_count, effective_bytes, checksum, payload, committed_at_us \
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                row_id,
                session_id,
                &batch.binding_id,
                batch.payload.domain().as_str(),
                batch.epoch,
                batch.sequence_start,
                batch.sequence_end(),
                first_timestamp,
                last_timestamp,
                batch.payload.item_count() as u64,
                effective_bytes as u64,
                checksum,
                payload,
                now_us(),
            ],
        )?;
        Ok(effective_bytes)
    }

    pub(crate) fn update_session(
        connection: &Connection,
        session_id: &str,
        state: SessionState,
    ) -> Result<(), RecordingError> {
        let ended = matches!(state, SessionState::Stopped | SessionState::Failed).then(now_us);
        connection.execute(
            "UPDATE recording_sessions SET state=?, ended_at_us=? WHERE id=?",
            params![state.as_str(), ended, session_id],
        )?;
        Ok(())
    }
}

/// A process crash cannot have committed data after the final transaction. Mark
/// orphaned sessions explicitly while retaining their last valid commit.
fn mark_orphaned_sessions(connection: &Connection) -> Result<(), RecordingError> {
    connection.execute(
        "UPDATE recording_sessions SET state='failed', ended_at_us=? \
         WHERE state IN ('running', 'paused')",
        params![now_us()],
    )?;
    Ok(())
}

/// 自动重建后的可见提示 — 走健康报告的 warning 通道, **绝不进 `failed`/故障**:
/// 重建成功意味着录制已恢复, 把它当故障会立刻停掉采集。
pub fn rebuilt_note(backup: &Path) -> String {
    format!(
        "the recording database catalog was damaged and was rebuilt automatically \
         (the damaged copy is kept at {})",
        backup.display()
    )
}

/// 文件级损坏被隔离后的可见提示 — 同样走健康报告的 warning 通道。
///
/// 说清三件事: 旧文件读不出来、它被完整保留在哪里、录制已经在新的空库里继续。
pub fn quarantined_note(backup: &Path) -> String {
    format!(
        "the recording database file could not be read and was moved aside \
         (the unreadable copy is kept at {}); recording continues in a new empty database",
        backup.display()
    )
}

fn insert_binding(
    connection: &Connection,
    session_id: &str,
    binding: &DisplayBinding,
) -> Result<(), RecordingError> {
    connection.execute(
        "INSERT INTO display_bindings( \
            id, session_id, component_id, source_node_id, source_handle, domain, capability, bound_at_us \
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(session_id, id) DO UPDATE SET \
            component_id=excluded.component_id, source_node_id=excluded.source_node_id, \
            source_handle=excluded.source_handle, domain=excluded.domain, \
            capability=excluded.capability, bound_at_us=excluded.bound_at_us, unbound_at_us=NULL",
        params![
            &binding.id,
            session_id,
            &binding.component_id,
            &binding.port.source_node_id,
            &binding.port.source_handle,
            binding.domain.as_str(),
            binding.capability.as_str(),
            now_us(),
        ],
    )?;
    Ok(())
}

pub fn parse_domain(value: &str) -> Domain {
    match value {
        "bytes" => Domain::Bytes,
        "string" => Domain::String,
        "spectrum" => Domain::Spectrum,
        _ => Domain::Float,
    }
}

pub fn parse_state(value: &str) -> SessionState {
    match value {
        "running" => SessionState::Running,
        "paused" => SessionState::Paused,
        "stopped" => SessionState::Stopped,
        _ => SessionState::Failed,
    }
}

fn now_us() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_micros()).unwrap_or(u64::MAX)
        })
}

pub fn to_duckdb_error(error: impl std::fmt::Display) -> duckdb::Error {
    duckdb::Error::InvalidParameterName(error.to_string())
}
