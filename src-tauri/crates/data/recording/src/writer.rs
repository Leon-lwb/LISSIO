use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use parking_lot::{Mutex, RwLock};
use thiserror::Error;

use crate::{
    DisplayBinding, Domain, RecordBatch, RecordingCleanupResult, RecordingHealth, RecordingLimits,
    RecordingStore, SessionInfo, SessionState,
};

#[derive(Debug, Error)]
pub enum RecordingError {
    #[error("database error: {0}")]
    Database(#[from] duckdb::Error),
    #[error("recording I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid recording data: {0}")]
    Invalid(String),
    #[error("corrupt recording data: {0}")]
    Corrupt(String),
    #[error("recording queue is full")]
    Backpressure,
    #[error("recording writer is closed")]
    Closed,
    #[error("recording writer failed: {0}")]
    Failed(String),
}

#[derive(Debug, Default)]
struct HealthState {
    accepted_batches: AtomicU64,
    accepted_bytes: AtomicU64,
    persisted_batches: AtomicU64,
    persisted_bytes: AtomicU64,
    accepted_sequence: AtomicU64,
    persisted_sequence: AtomicU64,
    queued_batches: AtomicU64,
    failed: Mutex<Option<String>>,
}

#[derive(Debug)]
enum Command {
    Append(RecordBatch),
    Bind(DisplayBinding, mpsc::Sender<Result<(), String>>),
    Unbind(String, mpsc::Sender<Result<(), String>>),
    State(SessionState, mpsc::Sender<Result<(), String>>),
    DeleteSessions(
        Vec<String>,
        mpsc::Sender<Result<RecordingCleanupResult, String>>,
    ),
    Flush(mpsc::Sender<Result<(), String>>),
    Shutdown(mpsc::Sender<Result<(), String>>),
}

#[derive(Debug)]
pub struct Recorder {
    store: RecordingStore,
    session: SessionInfo,
    sender: mpsc::SyncSender<Command>,
    health: Arc<HealthState>,
    bindings: Arc<RwLock<HashMap<String, Domain>>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Recorder {
    pub fn start(
        store: RecordingStore,
        bindings: Vec<DisplayBinding>,
        limits: RecordingLimits,
    ) -> Result<Self, RecordingError> {
        if limits.queue_batches == 0
            || limits.transaction_bytes == 0
            || limits.commit_interval_ms == 0
        {
            return Err(RecordingError::Invalid(
                "recording limits must be greater than zero".into(),
            ));
        }
        let session = store.create_session(&bindings)?;
        let binding_domains = bindings
            .into_iter()
            .map(|binding| (binding.id, binding.domain))
            .collect();
        let bindings = Arc::new(RwLock::new(binding_domains));
        let health = Arc::new(HealthState::default());
        let (sender, receiver) = mpsc::sync_channel(limits.queue_batches);
        let writer_store = store.clone();
        let writer_session = session.id.clone();
        let writer_health = health.clone();
        let thread = std::thread::Builder::new()
            .name("recording-writer".into())
            .spawn(move || {
                run_writer(
                    &writer_store,
                    &writer_session,
                    limits,
                    receiver,
                    &writer_health,
                );
            })?;
        Ok(Self {
            store,
            session,
            sender,
            health,
            bindings,
            thread: Mutex::new(Some(thread)),
        })
    }

    #[must_use]
    pub const fn session(&self) -> &SessionInfo {
        &self.session
    }

    #[must_use]
    pub const fn store(&self) -> &RecordingStore {
        &self.store
    }

    pub fn append(&self, batch: RecordBatch) -> Result<(), RecordingError> {
        let failure = self.health.failed.lock().clone();
        if let Some(error) = failure {
            return Err(RecordingError::Failed(error));
        }
        let expected = self.bindings.read().get(&batch.binding_id).copied();
        if expected != Some(batch.payload.domain()) {
            return Err(RecordingError::Invalid(format!(
                "binding {} is absent or has a different domain",
                batch.binding_id
            )));
        }
        let bytes = batch.payload.effective_bytes() as u64;
        let sequence = batch.sequence_end();
        self.sender
            .try_send(Command::Append(batch))
            .map_err(|error| match error {
                mpsc::TrySendError::Full(_) => RecordingError::Backpressure,
                mpsc::TrySendError::Disconnected(_) => RecordingError::Closed,
            })?;
        self.health.accepted_batches.fetch_add(1, Ordering::Relaxed);
        self.health
            .accepted_bytes
            .fetch_add(bytes, Ordering::Relaxed);
        self.health
            .accepted_sequence
            .fetch_max(sequence, Ordering::Relaxed);
        self.health.queued_batches.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    pub fn bind(&self, binding: DisplayBinding) -> Result<(), RecordingError> {
        let (reply, response) = mpsc::channel();
        self.sender
            .send(Command::Bind(binding.clone(), reply))
            .map_err(|_| RecordingError::Closed)?;
        receive_result(response)?;
        self.bindings.write().insert(binding.id, binding.domain);
        Ok(())
    }

    pub fn unbind(&self, binding_id: &str) -> Result<(), RecordingError> {
        let (reply, response) = mpsc::channel();
        self.sender
            .send(Command::Unbind(binding_id.to_string(), reply))
            .map_err(|_| RecordingError::Closed)?;
        receive_result(response)?;
        self.bindings.write().remove(binding_id);
        Ok(())
    }

    pub fn set_state(&self, state: SessionState) -> Result<(), RecordingError> {
        let (reply, response) = mpsc::channel();
        self.sender
            .send(Command::State(state, reply))
            .map_err(|_| RecordingError::Closed)?;
        receive_result(response)
    }

    pub fn flush(&self) -> Result<(), RecordingError> {
        let (reply, response) = mpsc::channel();
        self.sender
            .send(Command::Flush(reply))
            .map_err(|_| RecordingError::Closed)?;
        receive_result(response)
    }

    pub fn delete_sessions(
        &self,
        session_ids: Vec<String>,
    ) -> Result<RecordingCleanupResult, RecordingError> {
        let (reply, response) = mpsc::channel();
        self.sender
            .send(Command::DeleteSessions(session_ids, reply))
            .map_err(|_| RecordingError::Closed)?;
        response
            .recv()
            .map_err(|_| RecordingError::Closed)?
            .map_err(RecordingError::Failed)
    }

    pub fn shutdown(&self) -> Result<(), RecordingError> {
        let mut thread = self.thread.lock();
        let Some(handle) = thread.take() else {
            return Ok(());
        };
        let (reply, response) = mpsc::channel();
        self.sender
            .send(Command::Shutdown(reply))
            .map_err(|_| RecordingError::Closed)?;
        let result = receive_result(response);
        handle.join().map_err(|_| RecordingError::Closed)?;
        result
    }

    #[must_use]
    pub fn health(&self) -> RecordingHealth {
        RecordingHealth {
            accepted_batches: self.health.accepted_batches.load(Ordering::Relaxed),
            accepted_bytes: self.health.accepted_bytes.load(Ordering::Relaxed),
            persisted_batches: self.health.persisted_batches.load(Ordering::Relaxed),
            persisted_bytes: self.health.persisted_bytes.load(Ordering::Relaxed),
            accepted_sequence: self.health.accepted_sequence.load(Ordering::Relaxed),
            persisted_sequence: self.health.persisted_sequence.load(Ordering::Relaxed),
            queued_batches: self.health.queued_batches.load(Ordering::Relaxed),
            failed: self.health.failed.lock().clone(),
        }
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

fn run_writer(
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

fn run_writer_inner(
    store: &RecordingStore,
    session_id: &str,
    limits: RecordingLimits,
    receiver: &mpsc::Receiver<Command>,
    health: &HealthState,
) -> Result<(), RecordingError> {
    let connection = store.connect()?;
    let mut row_id = RecordingStore::next_row_id(&connection)?;
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
                    connection.execute_batch("BEGIN TRANSACTION")?;
                    transaction_open = true;
                }
                let bytes = RecordingStore::write_batch(&connection, session_id, row_id, &batch)?;
                row_id = row_id.saturating_add(1);
                pending_bytes = pending_bytes.saturating_add(bytes);
                pending.push((batch.sequence_end(), bytes));
                if pending_bytes >= limits.transaction_bytes {
                    commit(&connection, health, &mut pending, &mut pending_bytes)?;
                    transaction_open = false;
                    last_commit = Instant::now();
                }
            }
            Ok(Command::Bind(binding, reply)) => {
                let result = RecordingStore::insert_binding(&connection, session_id, &binding)
                    .map_err(|error| error.to_string());
                let _ = reply.send(result);
            }
            Ok(Command::Unbind(binding_id, reply)) => {
                let result = RecordingStore::close_binding(&connection, session_id, &binding_id)
                    .map_err(|error| error.to_string());
                let _ = reply.send(result);
            }
            Ok(Command::State(state, reply)) => {
                let result = (|| {
                    if transaction_open {
                        commit(&connection, health, &mut pending, &mut pending_bytes)?;
                        transaction_open = false;
                    }
                    RecordingStore::update_session(&connection, session_id, state)
                })()
                .map_err(|error| error.to_string());
                let _ = reply.send(result);
                last_commit = Instant::now();
            }
            Ok(Command::DeleteSessions(session_ids, reply)) => {
                let result = (|| {
                    if transaction_open {
                        commit(&connection, health, &mut pending, &mut pending_bytes)?;
                        transaction_open = false;
                    }
                    crate::maintenance::delete_sessions_on(&connection, session_id, &session_ids)
                })()
                .map_err(|error| error.to_string());
                let _ = reply.send(result);
                last_commit = Instant::now();
            }
            Ok(Command::Flush(reply)) => {
                let result = if transaction_open {
                    commit(&connection, health, &mut pending, &mut pending_bytes)
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
                        commit(&connection, health, &mut pending, &mut pending_bytes)?;
                    }
                    RecordingStore::update_session(&connection, session_id, SessionState::Stopped)
                })()
                .map_err(|error| error.to_string());
                let _ = reply.send(result);
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if transaction_open {
                    commit(&connection, health, &mut pending, &mut pending_bytes)?;
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

fn receive_result(receiver: mpsc::Receiver<Result<(), String>>) -> Result<(), RecordingError> {
    receiver
        .recv()
        .map_err(|_| RecordingError::Closed)?
        .map_err(RecordingError::Failed)
}
