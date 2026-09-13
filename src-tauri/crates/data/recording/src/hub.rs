use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::RwLock;

use crate::{
    BatchPayload, BindingInfo, DisplayBinding, PortIdentity, RecordBatch, Recorder,
    RecordingCleanupPolicy, RecordingCleanupResult, RecordingDatabaseInfo, RecordingError,
    RecordingHealth, RecordingLimits, RecordingStore, SessionInfo, SessionState, SessionSummary,
};

mod spawn;

use spawn::{RecordingTarget, spawn_recorder};

/// Database coordinates captured at `start` so creating or resuming a session
/// reuses the same store without the caller supplying them again.
#[derive(Debug, Clone)]
struct HubDatabase {
    path: PathBuf,
    limits: RecordingLimits,
}

#[derive(Debug, Default)]
struct HubState {
    recorder: Option<Arc<Recorder>>,
    active: HashMap<PortIdentity, DisplayBinding>,
    sequences: HashMap<PortIdentity, u64>,
    fault: Option<String>,
    database: Option<HubDatabase>,
}

/// Cloneable recording port shared by producers in all four domains.
#[derive(Clone, Default)]
pub struct RecordingHub {
    state: Arc<RwLock<HubState>>,
    queries: Arc<RwLock<HashMap<String, Arc<duckdb::InterruptHandle>>>>,
}

impl RecordingHub {
    /// Start recording at `path` with initial session state `initial`.
    ///
    /// The newest session is resumed when it holds no batches (see
    /// [`RecordingStore::resumable_empty_session`]), so restarts without any
    /// recorded data keep writing into one session instead of accumulating
    /// empty ones; otherwise a brand-new session is created.
    pub fn start(
        &self,
        path: impl AsRef<Path>,
        bindings: Vec<DisplayBinding>,
        limits: RecordingLimits,
        initial: SessionState,
    ) -> Result<SessionInfo, RecordingError> {
        let path = path.as_ref().to_path_buf();
        let active = unique_bindings(bindings);
        self.replace_recording(
            &path,
            limits,
            active,
            RecordingTarget::ContinueEmpty,
            initial,
        )
    }

    /// Start writing into a brand-new session in the same database, replacing
    /// the current recorder. The replaced session is marked stopped.
    pub fn create_session(&self, initial: SessionState) -> Result<SessionInfo, RecordingError> {
        let (path, limits, active) = self.database_and_bindings()?;
        self.replace_recording(&path, limits, active, RecordingTarget::New, initial)
    }

    /// Resume writing into an existing stopped session, replacing the current
    /// recorder. The replaced session is marked stopped.
    pub fn switch_session(
        &self,
        session_id: &str,
        initial: SessionState,
    ) -> Result<SessionInfo, RecordingError> {
        let (path, limits, active) = self.database_and_bindings()?;
        if self.current_session_id().as_deref() == Some(session_id) {
            return Err(RecordingError::Invalid(
                "session is already the active recording target".into(),
            ));
        }
        {
            let store = self.store().ok_or(RecordingError::Closed)?;
            let target = store
                .list_sessions()?
                .into_iter()
                .find(|session| session.id == session_id)
                .ok_or_else(|| {
                    RecordingError::Invalid(format!(
                        "recording session was not found: {session_id}"
                    ))
                })?;
            if target.state != SessionState::Stopped {
                return Err(RecordingError::Invalid(format!(
                    "only stopped recording sessions can be resumed: {session_id}"
                )));
            }
        }
        self.replace_recording(
            &path,
            limits,
            active,
            RecordingTarget::Resume(session_id.to_string()),
            initial,
        )
    }

    /// Apply persisted storage preferences replayed from settings: the
    /// database path and the empty-session continuation toggle. Only swaps
    /// the recorder when the effective target changed; must not be called
    /// while the run is active (see [`RecordingHub::create_session`]).
    pub fn apply_settings(
        &self,
        database_path: Option<PathBuf>,
        continue_empty: bool,
        initial: SessionState,
    ) -> Result<bool, RecordingError> {
        spawn::apply_settings(self, database_path, continue_empty, initial)
    }

    /// Swap in a recorder for `target`, resuming into `initial`.
    ///
    /// The previous writer must fully close its DuckDB instance before the
    /// replacement opens its own: `Connection::open` creates an independent
    /// database instance, and concurrent instances on one file checkpoint over
    /// each other, silently erasing committed writes. While the recorder is
    /// absent no batches are produced, so this window must only be entered
    /// while the run is paused.
    fn replace_recording(
        &self,
        path: &Path,
        limits: RecordingLimits,
        active: HashMap<PortIdentity, DisplayBinding>,
        target: RecordingTarget,
        initial: SessionState,
    ) -> Result<SessionInfo, RecordingError> {
        let shutdown = self.take_recorder().map(|recorder| recorder.shutdown());
        if let Some(Err(error)) = shutdown {
            self.state.write().fault = Some(error.to_string());
            return Err(error);
        }
        let outcome = spawn_recorder(path, limits, active.clone(), target, initial);
        match outcome {
            Ok(recorder) => {
                let session = recorder.session().clone();
                let mut state = self.state.write();
                state.recorder = Some(recorder);
                state.active = active;
                state.sequences.clear();
                state.fault = None;
                state.database = Some(HubDatabase {
                    path: path.to_path_buf(),
                    limits,
                });
                Ok(session)
            }
            Err(error) => {
                self.state.write().fault = Some(error.to_string());
                Err(error)
            }
        }
    }

    fn database_and_bindings(
        &self,
    ) -> Result<
        (
            PathBuf,
            RecordingLimits,
            HashMap<PortIdentity, DisplayBinding>,
        ),
        RecordingError,
    > {
        let state = self.state.read();
        let database = state.database.as_ref().ok_or(RecordingError::Closed)?;
        Ok((database.path.clone(), database.limits, state.active.clone()))
    }

    fn take_recorder(&self) -> Option<Arc<Recorder>> {
        self.state.write().recorder.take()
    }

    #[must_use]
    fn current_session_id(&self) -> Option<String> {
        self.state
            .read()
            .recorder
            .as_ref()
            .map(|recorder| recorder.session().id.clone())
    }

    /// Replace active display bindings. Existing rows stay queryable; a removed
    /// binding immediately stops accepting new batches.
    pub fn sync_bindings(&self, bindings: Vec<DisplayBinding>) -> Result<(), RecordingError> {
        let next = unique_bindings(bindings);
        let mut state = self.state.write();
        if let Some(recorder) = &state.recorder {
            for (port, binding) in &state.active {
                if !next.contains_key(port)
                    && let Err(error) = recorder.unbind(&binding.id)
                {
                    state.fault = Some(error.to_string());
                    return Err(error);
                }
            }
            for (port, binding) in &next {
                if !state.active.contains_key(port)
                    && let Err(error) = recorder.bind(binding.clone())
                {
                    state.fault = Some(error.to_string());
                    return Err(error);
                }
            }
        }
        state.active = next;
        Ok(())
    }

    #[must_use]
    pub fn is_bound(&self, port: &PortIdentity) -> bool {
        self.state.read().active.contains_key(port)
    }

    pub fn record(
        &self,
        port: &PortIdentity,
        epoch: u64,
        sequence_start: u64,
        timestamps_us: Vec<u64>,
        payload: BatchPayload,
    ) -> Result<bool, RecordingError> {
        let mut state = self.state.write();
        let Some(binding) = state.active.get(port) else {
            return Ok(false);
        };
        let Some(recorder) = &state.recorder else {
            return Ok(false);
        };
        if let Err(error) = recorder.append(RecordBatch {
            binding_id: binding.id.clone(),
            epoch,
            sequence_start,
            timestamps_us,
            payload,
        }) {
            state.fault = Some(error.to_string());
            return Err(error);
        }
        Ok(true)
    }

    pub fn record_next(
        &self,
        port: &PortIdentity,
        epoch: u64,
        timestamps_us: Vec<u64>,
        payload: BatchPayload,
    ) -> Result<bool, RecordingError> {
        let mut state = self.state.write();
        let Some(binding) = state.active.get(port) else {
            return Ok(false);
        };
        let binding_id = binding.id.clone();
        let Some(recorder) = state.recorder.clone() else {
            return Ok(false);
        };
        let sequence = state.sequences.get(port).copied().unwrap_or_default();
        let count = payload.item_count() as u64;
        if let Err(error) = recorder.append(RecordBatch {
            binding_id,
            epoch,
            sequence_start: sequence,
            timestamps_us,
            payload,
        }) {
            state.fault = Some(error.to_string());
            return Err(error);
        }
        state
            .sequences
            .insert(port.clone(), sequence.saturating_add(count));
        Ok(true)
    }

    pub fn set_state(&self, state: SessionState) -> Result<(), RecordingError> {
        let mut hub = self.state.write();
        if let Some(recorder) = &hub.recorder
            && let Err(error) = recorder.set_state(state)
        {
            hub.fault = Some(error.to_string());
            return Err(error);
        }
        Ok(())
    }

    pub fn flush(&self) -> Result<(), RecordingError> {
        let mut state = self.state.write();
        if let Some(recorder) = &state.recorder
            && let Err(error) = recorder.flush()
        {
            state.fault = Some(error.to_string());
            return Err(error);
        }
        Ok(())
    }

    pub fn stop(&self) -> Result<(), RecordingError> {
        let recorder = self.state.write().recorder.take();
        if let Some(recorder) = recorder {
            recorder.shutdown()?;
        }
        Ok(())
    }

    pub fn delete_session(&self, session_id: &str) -> Result<(), RecordingError> {
        self.cleanup_sessions(RecordingCleanupPolicy {
            session_ids: Vec::from([session_id.to_string()]),
            ..RecordingCleanupPolicy::default()
        })
        .map(|_| ())
    }

    pub fn list_bindings(&self, session_id: &str) -> Result<Vec<BindingInfo>, RecordingError> {
        let store = self.store().ok_or(RecordingError::Closed)?;
        store.list_bindings(session_id)
    }

    pub fn list_session_summaries(&self) -> Result<Vec<SessionSummary>, RecordingError> {
        let store = self.store().ok_or(RecordingError::Closed)?;
        let mut summaries = store.list_session_summaries()?;
        if let Some(current_id) = self.current_session_id() {
            for summary in &mut summaries {
                if summary.session.id == current_id {
                    summary.active = true;
                }
            }
        }
        Ok(summaries)
    }

    pub fn database_info(&self) -> Result<RecordingDatabaseInfo, RecordingError> {
        let store = self.store().ok_or(RecordingError::Closed)?;
        store.database_info()
    }

    pub fn cleanup_sessions(
        &self,
        policy: RecordingCleanupPolicy,
    ) -> Result<RecordingCleanupResult, RecordingError> {
        let store = self.store().ok_or(RecordingError::Closed)?;
        let sessions = store.list_sessions()?;
        let recorder = {
            let state = self.state.read();
            state.recorder.clone().ok_or(RecordingError::Closed)?
        };
        let current_id = recorder.session().id.clone();
        let session_ids = cleanup_session_ids(&sessions, &current_id, &policy)?;
        if session_ids.is_empty() {
            return Ok(RecordingCleanupResult::default());
        }
        recorder.delete_sessions(session_ids)
    }

    #[must_use]
    pub fn health(&self) -> RecordingHealth {
        let state = self.state.read();
        let mut health = state
            .recorder
            .as_ref()
            .map_or_else(RecordingHealth::default, |recorder| recorder.health());
        if health.failed.is_none() {
            health.failed.clone_from(&state.fault);
        }
        health
    }

    #[must_use]
    pub fn fault(&self) -> Option<String> {
        let state = self.state.read();
        state.fault.clone().or_else(|| {
            state
                .recorder
                .as_ref()
                .and_then(|recorder| recorder.health().failed)
        })
    }

    #[must_use]
    pub fn store(&self) -> Option<RecordingStore> {
        self.state
            .read()
            .recorder
            .as_ref()
            .map(|recorder| recorder.store().clone())
    }

    pub fn query_sql(
        &self,
        query_id: &str,
        sql: &str,
        max_rows: usize,
    ) -> Result<crate::SqlResult, RecordingError> {
        if query_id.is_empty() {
            return Err(RecordingError::Invalid("query id is empty".into()));
        }
        let store = self.store().ok_or(RecordingError::Closed)?;
        let connection = store.connect()?;
        let interrupt = connection.interrupt_handle();
        {
            let mut queries = self.queries.write();
            if queries.contains_key(query_id) {
                return Err(RecordingError::Invalid("query id is already active".into()));
            }
            queries.insert(query_id.to_string(), interrupt);
        }
        let result = RecordingStore::query_sql_on(&connection, sql, max_rows);
        self.queries.write().remove(query_id);
        result
    }

    pub fn cancel_query(&self, query_id: &str) -> bool {
        let handle = self.queries.read().get(query_id).cloned();
        handle.is_some_and(|handle| {
            handle.interrupt();
            true
        })
    }
}

fn unique_bindings(bindings: Vec<DisplayBinding>) -> HashMap<PortIdentity, DisplayBinding> {
    bindings
        .into_iter()
        .map(|binding| (binding.port.clone(), binding))
        .collect()
}

fn cleanup_session_ids(
    sessions: &[SessionInfo],
    current_session_id: &str,
    policy: &RecordingCleanupPolicy,
) -> Result<Vec<String>, RecordingError> {
    let by_id: HashMap<&str, &SessionInfo> = sessions
        .iter()
        .map(|session| (session.id.as_str(), session))
        .collect();
    for id in &policy.session_ids {
        if id == current_session_id {
            return Err(RecordingError::Invalid(
                "the current recording session cannot be deleted".into(),
            ));
        }
        if !(by_id.contains_key(id.as_str())) {
            return Err(RecordingError::Invalid(format!(
                "recording session was not found: {id}"
            )));
        }
    }
    let mut selected: HashSet<String> = policy.session_ids.iter().cloned().collect();
    let is_terminal = |session: &SessionInfo| {
        session.state == SessionState::Stopped || session.state == SessionState::Failed
    };
    for session in sessions {
        if session.id == current_session_id || !(is_terminal(session)) {
            continue;
        }
        if (policy.delete_stopped && session.state == SessionState::Stopped)
            || (policy.delete_failed && session.state == SessionState::Failed)
        {
            selected.insert(session.id.clone());
        }
        if let Some(threshold) = policy.older_than_us {
            let ended_at = session.ended_at_us.unwrap_or(session.started_at_us);
            if ended_at < threshold {
                selected.insert(session.id.clone());
            }
        }
    }
    if let Some(keep_latest) = policy.keep_latest {
        let mut terminal: Vec<&SessionInfo> = sessions
            .iter()
            .filter(|session| session.id != current_session_id && is_terminal(session))
            .collect();
        terminal.sort_by_key(|session| std::cmp::Reverse(session.started_at_us));
        for session in terminal.into_iter().skip(keep_latest) {
            selected.insert(session.id.clone());
        }
    }
    Ok(selected.into_iter().collect())
}
