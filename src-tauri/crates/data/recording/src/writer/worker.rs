//! Writer-thread loop: transaction batching, healing cleanup, session state.

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use duckdb::Connection;

use super::{Command, HealthState};
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
        if let Ok(connection) = store.connect() {
            let _ = RecordingStore::update_session(&connection, session_id, SessionState::Failed);
        }
    }
}

/// The writer thread's single database handle.
///
/// Cleanup can detect a damaged database catalog, which requires closing the
/// handle, rebuilding the file, and reopening it.
struct WriterStorage {
    connection: Option<Connection>,
}

impl WriterStorage {
    fn open(store: &RecordingStore) -> Result<Self, RecordingError> {
        Ok(Self {
            connection: Some(store.connect()?),
        })
    }

    fn connection(&self) -> Result<&Connection, RecordingError> {
        self.connection.as_ref().ok_or_else(|| {
            RecordingError::Failed("the recording database connection is closed".into())
        })
    }

    /// Rebuild the database file and reopen it, keeping the writer usable.
    fn rebuild(&mut self, store: &RecordingStore) -> Result<PathBuf, RecordingError> {
        self.connection = None;
        let outcome = crate::repair::rebuild_database(store.path());
        self.connection = Some(store.connect()?);
        outcome
    }
}

/// Delete sessions, rebuilding the database file once when its catalog is damaged.
fn delete_sessions_healing(
    store: &RecordingStore,
    storage: &mut WriterStorage,
    current_session_id: &str,
    session_ids: &[String],
) -> Result<RecordingCleanupResult, RecordingError> {
    let failure = match crate::maintenance::delete_sessions_on(
        storage.connection()?,
        current_session_id,
        session_ids,
    ) {
        Ok(result) => return Ok(result),
        Err(error) => error,
    };
    if !crate::repair::is_catalog_damage(&failure) {
        return Err(failure);
    }
    let backup = storage.rebuild(store).map_err(|repair| {
        RecordingError::Failed(format!("{failure}; database rebuild failed: {repair}"))
    })?;
    let mut result = crate::maintenance::delete_sessions_on(
        storage.connection()?,
        current_session_id,
        session_ids,
    )?;
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
    let mut row_id = RecordingStore::next_row_id(storage.connection()?)?;
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
                    storage.connection()?.execute_batch("BEGIN TRANSACTION")?;
                    transaction_open = true;
                }
                let bytes =
                    RecordingStore::write_batch(storage.connection()?, session_id, row_id, &batch)?;
                row_id = row_id.saturating_add(1);
                pending_bytes = pending_bytes.saturating_add(bytes);
                pending.push((batch.sequence_end(), bytes));
                if pending_bytes >= limits.transaction_bytes {
                    commit(
                        storage.connection()?,
                        health,
                        &mut pending,
                        &mut pending_bytes,
                    )?;
                    transaction_open = false;
                    last_commit = Instant::now();
                }
            }
            Ok(Command::Bind(binding, reply)) => {
                let result =
                    RecordingStore::insert_binding(storage.connection()?, session_id, &binding)
                        .map_err(|error| error.to_string());
                let _ = reply.send(result);
            }
            Ok(Command::Unbind(binding_id, reply)) => {
                let result =
                    RecordingStore::close_binding(storage.connection()?, session_id, &binding_id)
                        .map_err(|error| error.to_string());
                let _ = reply.send(result);
            }
            Ok(Command::State(state, reply)) => {
                let result = (|| {
                    if transaction_open {
                        commit(
                            storage.connection()?,
                            health,
                            &mut pending,
                            &mut pending_bytes,
                        )?;
                        transaction_open = false;
                    }
                    RecordingStore::update_session(storage.connection()?, session_id, state)
                })()
                .map_err(|error| error.to_string());
                let _ = reply.send(result);
                last_commit = Instant::now();
            }
            Ok(Command::DeleteSessions(session_ids, reply)) => {
                let result = (|| {
                    if transaction_open {
                        commit(
                            storage.connection()?,
                            health,
                            &mut pending,
                            &mut pending_bytes,
                        )?;
                        transaction_open = false;
                    }
                    delete_sessions_healing(store, &mut storage, session_id, &session_ids)
                })()
                .map_err(|error| error.to_string());
                let _ = reply.send(result);
                last_commit = Instant::now();
            }
            Ok(Command::Flush(reply)) => {
                let result = if transaction_open {
                    commit(
                        storage.connection()?,
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
            Ok(Command::Shutdown(reply)) => {
                let result = (|| {
                    if transaction_open {
                        commit(
                            storage.connection()?,
                            health,
                            &mut pending,
                            &mut pending_bytes,
                        )?;
                    }
                    RecordingStore::update_session(
                        storage.connection()?,
                        session_id,
                        SessionState::Stopped,
                    )
                })()
                .map_err(|error| error.to_string());
                let _ = reply.send(result);
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if transaction_open {
                    commit(
                        storage.connection()?,
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
    connection: &duckdb::Connection,
    health: &HealthState,
    pending: &mut Vec<(u64, usize)>,
    pending_bytes: &mut usize,
) -> Result<(), RecordingError> {
    connection.execute_batch("COMMIT")?;
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
