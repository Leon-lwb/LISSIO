//! Writer-thread loop: transaction batching, healing cleanup, session state.
//!
//! The loop holds one [`StoreSession`] and never names an engine: everything it
//! executes goes through the store port.

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use super::{Command, HealthState};
use crate::port::StoreSession;
use crate::{
    RecordingCleanupResult, RecordingError, RecordingLimits, RecordingStore, SessionState,
};

pub(super) fn run_writer(
    store: &RecordingStore,
    session_id: &str,
    limits: RecordingLimits,
    receiver: mpsc::Receiver<Command>,
    health: &HealthState,
) {
    let result = run_writer_inner(store, session_id, limits, &receiver, health);
    if let Err(error) = result {
        *health.failed.lock() = Some(error.to_string());
        // The writer failed: mark the session failed on a fresh handle when one
        // can still be opened.
        if let Ok(mut session) = store.connect() {
            let _ = session.update_session(session_id, SessionState::Failed);
        }
    }
}

/// The writer thread's single database handle.
///
/// Cleanup can detect a damaged catalog, which requires closing the handle,
/// rebuilding the file, and reopening it; the session performs that in place, so
/// the writer keeps its one handle across a heal.
struct WriterStorage {
    session: Option<Box<dyn StoreSession>>,
}

impl WriterStorage {
    fn open(store: &RecordingStore) -> Result<Self, RecordingError> {
        Ok(Self {
            session: Some(store.connect()?),
        })
    }

    fn session_mut(&mut self) -> Result<&mut (dyn StoreSession + 'static), RecordingError> {
        self.session.as_deref_mut().ok_or_else(|| {
            RecordingError::Failed("the recording database connection is closed".into())
        })
    }

    /// Rebuild the database file and reopen it, keeping the writer usable.
    fn rebuild(&mut self) -> Result<PathBuf, RecordingError> {
        self.session_mut()?.rebuild()
    }
}

/// One read on the writer's connection.
///
/// A failure is reported to the caller and **never** ends the writer: a failed
/// read must not stop an active recording.
fn read<T>(
    storage: &mut WriterStorage,
    run: impl FnOnce(&mut (dyn StoreSession + 'static)) -> Result<T, RecordingError>,
) -> Result<T, RecordingError> {
    run(storage.session_mut()?)
}

/// Delete sessions, rebuilding the database file once when its catalog is damaged.
fn delete_sessions_healing(
    storage: &mut WriterStorage,
    current_session_id: &str,
    session_ids: &[String],
) -> Result<RecordingCleanupResult, RecordingError> {
    let failure = match storage
        .session_mut()?
        .delete_sessions(current_session_id, session_ids)
    {
        Ok(result) => return Ok(result),
        Err(error) => error,
    };
    if !storage.session_mut()?.is_recoverable(&failure) {
        return Err(failure);
    }
    let backup = storage.rebuild().map_err(|repair| {
        RecordingError::Failed(format!("{failure}; database rebuild failed: {repair}"))
    })?;
    let mut result = storage
        .session_mut()?
        .delete_sessions(current_session_id, session_ids)?;
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

fn run_writer_inner(
    store: &RecordingStore,
    session_id: &str,
    limits: RecordingLimits,
    receiver: &mpsc::Receiver<Command>,
    health: &HealthState,
) -> Result<(), RecordingError> {
    let mut storage = WriterStorage::open(store)?;
    let mut row_id = storage.session_mut()?.next_row_id()?;
    let interval = Duration::from_millis(limits.commit_interval_ms);
    let mut transaction_open = false;
    let mut pending = Vec::new();
    let mut pending_bytes = 0_usize;
    let mut last_commit = Instant::now();
    loop {
        let command = receiver.recv_timeout(interval.saturating_sub(last_commit.elapsed()));
        match command {
            Ok(Command::Append(batch)) => {
                if !transaction_open {
                    storage.session_mut()?.begin()?;
                    transaction_open = true;
                }
                let bytes = storage
                    .session_mut()?
                    .write_batch(session_id, row_id, &batch)?;
                row_id = row_id.saturating_add(1);
                pending_bytes = pending_bytes.saturating_add(bytes);
                pending.push((batch.sequence_end(), bytes));
                if pending_bytes >= limits.transaction_bytes {
                    commit(
                        storage.session_mut()?,
                        health,
                        &mut pending,
                        &mut pending_bytes,
                    )?;
                    transaction_open = false;
                    last_commit = Instant::now();
                }
            }
            Ok(Command::Bind(binding, reply)) => {
                let result = storage
                    .session_mut()?
                    .insert_binding(session_id, &binding)
                    .map_err(|error| error.to_string());
                let _ = reply.send(result);
            }
            Ok(Command::Unbind(binding_id, reply)) => {
                let result = storage
                    .session_mut()?
                    .close_binding(session_id, &binding_id)
                    .map_err(|error| error.to_string());
                let _ = reply.send(result);
            }
            Ok(Command::State(state, reply)) => {
                let result = (|| {
                    if transaction_open {
                        commit(
                            storage.session_mut()?,
                            health,
                            &mut pending,
                            &mut pending_bytes,
                        )?;
                        transaction_open = false;
                    }
                    storage.session_mut()?.update_session(session_id, state)
                })()
                .map_err(|error| error.to_string());
                let _ = reply.send(result);
                last_commit = Instant::now();
            }
            Ok(Command::DeleteSessions(session_ids, reply)) => {
                let result = (|| {
                    if transaction_open {
                        commit(
                            storage.session_mut()?,
                            health,
                            &mut pending,
                            &mut pending_bytes,
                        )?;
                        transaction_open = false;
                    }
                    delete_sessions_healing(&mut storage, session_id, &session_ids)
                })()
                .map_err(|error| error.to_string());
                let _ = reply.send(result);
                last_commit = Instant::now();
            }
            Ok(Command::Flush(reply)) => {
                let result = if transaction_open {
                    commit(
                        storage.session_mut()?,
                        health,
                        &mut pending,
                        &mut pending_bytes,
                    )
                } else {
                    Ok(())
                }
                .map_err(|error| error.to_string());
                transaction_open = false;
                let _ = reply.send(result);
                last_commit = Instant::now();
            }
            // Read commands — all on the **same** connection, so a read never
            // opens a second instance on the database file.
            Ok(Command::ListSessions(reply)) => {
                let _ = reply.send(
                    read(&mut storage, StoreSession::list_sessions)
                        .map_err(|error| error.to_string()),
                );
            }
            Ok(Command::SessionSummaries(reply)) => {
                let _ = reply.send(
                    read(&mut storage, StoreSession::list_session_summaries)
                        .map_err(|error| error.to_string()),
                );
            }
            Ok(Command::DatabaseInfo(reply)) => {
                let _ = reply.send(
                    read(&mut storage, StoreSession::database_info)
                        .map_err(|error| error.to_string()),
                );
            }
            Ok(Command::Bindings(session_id, reply)) => {
                let _ = reply.send(
                    read(&mut storage, |session| session.list_bindings(&session_id))
                        .map_err(|error| error.to_string()),
                );
            }
            Ok(Command::SessionIsEmpty(session_id, reply)) => {
                let _ = reply.send(
                    read(&mut storage, |session| {
                        session.session_is_empty(&session_id)
                    })
                    .map_err(|error| error.to_string()),
                );
            }
            Ok(Command::DeleteSession(session_id, reply)) => {
                let _ = reply.send(
                    read(&mut storage, |session| session.delete_session(&session_id))
                        .map_err(|error| error.to_string()),
                );
            }
            Ok(Command::HistoryPage(query, reply)) => {
                let _ = reply.send(
                    read(&mut storage, |session| session.history_page(&query))
                        .map_err(|error| error.to_string()),
                );
            }
            Ok(Command::Sql {
                sql,
                max_rows,
                cancellation,
                reply,
            }) => {
                let result = read(&mut storage, |session| {
                    session.query_sql(&sql, max_rows, &cancellation)
                });
                let _ = reply.send(result.map_err(|error| error.to_string()));
            }
            Ok(Command::Shutdown(reply)) => {
                let result = (|| {
                    if transaction_open {
                        commit(
                            storage.session_mut()?,
                            health,
                            &mut pending,
                            &mut pending_bytes,
                        )?;
                    }
                    storage
                        .session_mut()?
                        .update_session(session_id, SessionState::Stopped)
                })()
                .map_err(|error| error.to_string());
                let _ = reply.send(result);
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if transaction_open {
                    commit(
                        storage.session_mut()?,
                        health,
                        &mut pending,
                        &mut pending_bytes,
                    )?;
                    transaction_open = false;
                }
                last_commit = Instant::now();
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    Ok(())
}

fn commit(
    session: &mut (dyn StoreSession + 'static),
    health: &HealthState,
    pending: &mut Vec<(u64, usize)>,
    pending_bytes: &mut usize,
) -> Result<(), RecordingError> {
    session.commit()?;
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
