//! Writer-task loop: transaction batching, healing cleanup, session state.
//!
//! The loop holds one [`StoreSession`] and never names an engine: everything it
//! executes goes through the store port. It runs as a task on the runtime the
//! writer thread owns, so engine I/O is async while the single-writer discipline
//! stays one thread.

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use tokio::sync::mpsc;

use super::{Command, HealthState};
use crate::port::StoreSession;
use crate::{
    RecordingCleanupResult, RecordingError, RecordingLimits, RecordingStore, SessionState,
};

pub(super) async fn run_writer(
    store: &RecordingStore,
    session_id: &str,
    limits: RecordingLimits,
    mut receiver: mpsc::Receiver<Command>,
    health: &HealthState,
) {
    // 批次是否曾经被写线程**取到**. 这个事实决定失败的性质:
    // 受理之前死 = 这段录制从未建立 (「没有录制」), 受理之后死 = 已受理批次
    // 落不了盘 (「录制失败」, 契约被破坏)。
    let mut accepted_any = false;
    let result = run_writer_inner(
        store,
        session_id,
        limits,
        &mut receiver,
        health,
        &mut accepted_any,
    )
    .await;
    if let Err(error) = result {
        record_writer_failure(health, accepted_any, &error);
        // The writer failed: mark the session failed on a fresh handle when one
        // can still be opened.
        if let Ok(mut session) = store.connect_async().await {
            let _ = session
                .update_session(session_id, SessionState::Failed)
                .await;
        }
    }
    // 原因必须先于通道关闭可见: 生产者与 hub 是经 `Closed` 才知道 writer 没了的,
    // 若先关通道, 那一瞬间的失败会被误判成「已受理批次落不了盘」(契约故障)。
    drop(receiver);
}

/// 登记写入循环的失败 — 处置取决于它死在哪个阶段。
///
/// **受理任何批次之前**失败 (连接 / 首批序号): 整段录制从未建立, 这是
/// 「没有录制」而不是「录制失败」— 写进非故障的 `unavailable` 通道, hub 据此
/// 不置 fault、不停止采集。**受理之后**失败: 已受理批次落不了盘 = 契约破坏,
/// 写进粘性的 `failed` (见 `docs/architecture/crates.md` 录制契约边界)。
fn record_writer_failure(health: &HealthState, accepted_any: bool, error: &RecordingError) {
    let slot = if accepted_any {
        &health.failed
    } else {
        &health.unavailable
    };
    *slot.lock() = Some(error.to_string());
}

/// The writer task's single database handle.
///
/// Cleanup can detect a damaged catalog, which requires closing the handle,
/// rebuilding the file, and reopening it; the session performs that in place, so
/// the writer keeps its one handle across a heal.
struct WriterStorage {
    session: Option<Box<dyn StoreSession>>,
}

impl WriterStorage {
    async fn open(store: &RecordingStore) -> Result<Self, RecordingError> {
        Ok(Self {
            session: Some(store.connect_async().await?),
        })
    }

    fn session_mut(&mut self) -> Result<&mut (dyn StoreSession + 'static), RecordingError> {
        self.session.as_deref_mut().ok_or_else(|| {
            RecordingError::Failed("the recording database connection is closed".into())
        })
    }

    /// Rebuild the database file and reopen it, keeping the writer usable.
    async fn rebuild(&mut self) -> Result<PathBuf, RecordingError> {
        self.session_mut()?.rebuild().await
    }
}

/// Delete sessions, rebuilding the database file once when its catalog is damaged.
async fn delete_sessions_healing(
    storage: &mut WriterStorage,
    current_session_id: &str,
    session_ids: &[String],
) -> Result<RecordingCleanupResult, RecordingError> {
    let failure = match storage
        .session_mut()?
        .delete_sessions(current_session_id, session_ids)
        .await
    {
        Ok(result) => return Ok(result),
        Err(error) => error,
    };
    if !storage.session_mut()?.is_recoverable(&failure) {
        return Err(failure);
    }
    let backup = storage.rebuild().await.map_err(|repair| {
        RecordingError::Failed(format!("{failure}; database rebuild failed: {repair}"))
    })?;
    let mut result = storage
        .session_mut()?
        .delete_sessions(current_session_id, session_ids)
        .await?;
    let healed = format!(
        "the recording database catalog was damaged and was rebuilt automatically \
         (the damaged copy is kept at {})",
        backup.display()
    );
    result.warning = Some(match result.warning {
        Some(skipped) => format!("{healed}; {skipped}"),
        None => healed,
    });
    Ok(result)
}

async fn run_writer_inner(
    store: &RecordingStore,
    session_id: &str,
    limits: RecordingLimits,
    receiver: &mut mpsc::Receiver<Command>,
    health: &HealthState,
    accepted_any: &mut bool,
) -> Result<(), RecordingError> {
    let mut storage = WriterStorage::open(store).await?;
    let mut row_id = storage.session_mut()?.next_row_id().await?;
    let interval = Duration::from_millis(limits.commit_interval_ms);
    let mut transaction_open = false;
    let mut pending = Vec::new();
    let mut pending_bytes = 0_usize;
    let mut last_commit = Instant::now();
    loop {
        let waited = tokio::time::timeout(
            interval.saturating_sub(last_commit.elapsed()),
            receiver.recv(),
        )
        .await;
        match waited {
            Ok(Some(Command::Append(batch))) => {
                // 从这里起, 任何失败都意味着已受理批次可能落不了盘。
                *accepted_any = true;
                if !transaction_open {
                    storage.session_mut()?.begin().await?;
                    transaction_open = true;
                }
                let bytes = storage
                    .session_mut()?
                    .write_batch(session_id, row_id, &batch)
                    .await?;
                row_id = row_id.saturating_add(1);
                pending_bytes = pending_bytes.saturating_add(bytes);
                pending.push((batch.sequence_end(), bytes));
                if pending_bytes >= limits.transaction_bytes {
                    commit(
                        storage.session_mut()?,
                        health,
                        &mut pending,
                        &mut pending_bytes,
                    )
                    .await?;
                    transaction_open = false;
                    last_commit = Instant::now();
                }
            }
            Ok(Some(Command::Bind(binding, reply))) => {
                let result = storage
                    .session_mut()?
                    .insert_binding(session_id, &binding)
                    .await
                    .map_err(|error| error.to_string());
                let _ = reply.send(result);
            }
            Ok(Some(Command::Unbind(binding_id, reply))) => {
                let result = storage
                    .session_mut()?
                    .close_binding(session_id, &binding_id)
                    .await
                    .map_err(|error| error.to_string());
                let _ = reply.send(result);
            }
            Ok(Some(Command::State(state, reply))) => {
                let result = async {
                    if transaction_open {
                        commit(
                            storage.session_mut()?,
                            health,
                            &mut pending,
                            &mut pending_bytes,
                        )
                        .await?;
                        transaction_open = false;
                    }
                    storage
                        .session_mut()?
                        .update_session(session_id, state)
                        .await
                }
                .await
                .map_err(|error| error.to_string());
                let _ = reply.send(result);
                last_commit = Instant::now();
            }
            Ok(Some(Command::DeleteSessions(session_ids, reply))) => {
                let result = async {
                    if transaction_open {
                        commit(
                            storage.session_mut()?,
                            health,
                            &mut pending,
                            &mut pending_bytes,
                        )
                        .await?;
                        transaction_open = false;
                    }
                    delete_sessions_healing(&mut storage, session_id, &session_ids).await
                }
                .await
                .map_err(|error| error.to_string());
                let _ = reply.send(result);
                last_commit = Instant::now();
            }
            Ok(Some(Command::Flush(reply))) => {
                let result = if transaction_open {
                    commit(
                        storage.session_mut()?,
                        health,
                        &mut pending,
                        &mut pending_bytes,
                    )
                    .await
                } else {
                    Ok(())
                }
                .map_err(|error| error.to_string());
                transaction_open = false;
                let _ = reply.send(result);
                last_commit = Instant::now();
            }
            // Read commands — all on the **same** connection, so a read never
            // opens a second instance on the database file. A failed read is
            // reported to the caller and never ends the writer.
            Ok(Some(Command::ListSessions(reply))) => {
                let result = match storage.session_mut() {
                    Ok(session) => session.list_sessions().await,
                    Err(error) => Err(error),
                };
                let _ = reply.send(result.map_err(|error| error.to_string()));
            }
            Ok(Some(Command::SessionSummaries(reply))) => {
                let result = match storage.session_mut() {
                    Ok(session) => session.list_session_summaries().await,
                    Err(error) => Err(error),
                };
                let _ = reply.send(result.map_err(|error| error.to_string()));
            }
            Ok(Some(Command::DatabaseInfo(reply))) => {
                let result = match storage.session_mut() {
                    Ok(session) => session.database_info().await,
                    Err(error) => Err(error),
                };
                let _ = reply.send(result.map_err(|error| error.to_string()));
            }
            Ok(Some(Command::Bindings(session_id, reply))) => {
                let result = match storage.session_mut() {
                    Ok(session) => session.list_bindings(&session_id).await,
                    Err(error) => Err(error),
                };
                let _ = reply.send(result.map_err(|error| error.to_string()));
            }
            Ok(Some(Command::SessionIsEmpty(session_id, reply))) => {
                let result = match storage.session_mut() {
                    Ok(session) => session.session_is_empty(&session_id).await,
                    Err(error) => Err(error),
                };
                let _ = reply.send(result.map_err(|error| error.to_string()));
            }
            Ok(Some(Command::DeleteSession(session_id, reply))) => {
                let result = match storage.session_mut() {
                    Ok(session) => session.delete_session(&session_id).await,
                    Err(error) => Err(error),
                };
                let _ = reply.send(result.map_err(|error| error.to_string()));
            }
            Ok(Some(Command::HistoryPage(query, reply))) => {
                let result = match storage.session_mut() {
                    Ok(session) => session.history_page(&query).await,
                    Err(error) => Err(error),
                };
                let _ = reply.send(result.map_err(|error| error.to_string()));
            }
            Ok(Some(Command::Sql {
                sql,
                max_rows,
                cancellation,
                reply,
            })) => {
                let result = match storage.session_mut() {
                    Ok(session) => session.query_sql(&sql, max_rows, &cancellation).await,
                    Err(error) => Err(error),
                };
                let _ = reply.send(result.map_err(|error| error.to_string()));
            }
            Ok(Some(Command::Shutdown(reply))) => {
                let result = async {
                    if transaction_open {
                        commit(
                            storage.session_mut()?,
                            health,
                            &mut pending,
                            &mut pending_bytes,
                        )
                        .await?;
                    }
                    storage
                        .session_mut()?
                        .update_session(session_id, SessionState::Stopped)
                        .await
                }
                .await
                .map_err(|error| error.to_string());
                let _ = reply.send(result);
                break;
            }
            // Sender dropped: no producer can reach the writer any more.
            Ok(None) => break,
            Err(_elapsed) => {
                if transaction_open {
                    commit(
                        storage.session_mut()?,
                        health,
                        &mut pending,
                        &mut pending_bytes,
                    )
                    .await?;
                    transaction_open = false;
                }
                last_commit = Instant::now();
            }
        }
    }
    Ok(())
}

async fn commit(
    session: &mut (dyn StoreSession + 'static),
    health: &HealthState,
    pending: &mut Vec<(u64, usize)>,
    pending_bytes: &mut usize,
) -> Result<(), RecordingError> {
    session.commit().await?;
    let count = pending.len() as u64;
    let sequence = pending
        .iter()
        .map(|entry| entry.0)
        .max()
        .unwrap_or_default();
    health.persisted_batches.fetch_add(count, Ordering::Relaxed);
    health
        .persisted_bytes
        .fetch_add(*pending_bytes as u64, Ordering::Relaxed);
    health
        .persisted_sequence
        .fetch_max(sequence, Ordering::Relaxed);
    health.queued_batches.fetch_sub(count, Ordering::Relaxed);
    pending.clear();
    *pending_bytes = 0;
    Ok(())
}

#[cfg(test)]
#[path = "worker_tests.rs"]
mod worker_tests;
