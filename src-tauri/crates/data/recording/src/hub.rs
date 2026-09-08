use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use parking_lot::RwLock;

use crate::{
    BatchPayload, DisplayBinding, PortIdentity, RecordBatch, Recorder, RecordingError,
    RecordingHealth, RecordingLimits, RecordingStore, SessionInfo, SessionState,
};

#[derive(Debug, Default)]
struct HubState {
    recorder: Option<Arc<Recorder>>,
    active: HashMap<PortIdentity, DisplayBinding>,
    sequences: HashMap<PortIdentity, u64>,
    fault: Option<String>,
}

/// Cloneable recording port shared by producers in all four domains.
#[derive(Clone, Default)]
pub struct RecordingHub {
    state: Arc<RwLock<HubState>>,
    queries: Arc<RwLock<HashMap<String, Arc<duckdb::InterruptHandle>>>>,
}

impl RecordingHub {
    pub fn start(
        &self,
        path: impl AsRef<Path>,
        bindings: Vec<DisplayBinding>,
        limits: RecordingLimits,
    ) -> Result<SessionInfo, RecordingError> {
        let store = RecordingStore::open(path)?;
        let active = unique_bindings(bindings);
        let recorder = Arc::new(Recorder::start(
            store,
            active.values().cloned().collect(),
            limits,
        )?);
        let session = recorder.session().clone();
        let previous = {
            let mut state = self.state.write();
            let previous = state.recorder.replace(recorder);
            state.active = active;
            state.sequences.clear();
            state.fault = None;
            previous
        };
        if let Some(previous) = previous {
            previous.shutdown()?;
        }
        Ok(session)
    }

    /// Replace active display bindings. Existing rows stay queryable; a removed
    /// binding immediately stops accepting new batches.
    pub fn sync_bindings(&self, bindings: Vec<DisplayBinding>) -> Result<(), RecordingError> {
        let next = unique_bindings(bindings);
        let mut state = self.state.write();
        if let Some(recorder) = &state.recorder {
            for (port, binding) in &state.active {
                if !next.contains_key(port) {
                    if let Err(error) = recorder.unbind(&binding.id) {
                        state.fault = Some(error.to_string());
                        return Err(error);
                    }
                }
            }
            for (port, binding) in &next {
                if !state.active.contains_key(port) {
                    if let Err(error) = recorder.bind(binding.clone()) {
                        state.fault = Some(error.to_string());
                        return Err(error);
                    }
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
        if let Some(recorder) = &hub.recorder {
            if let Err(error) = recorder.set_state(state) {
                hub.fault = Some(error.to_string());
                return Err(error);
            }
        }
        Ok(())
    }

    pub fn flush(&self) -> Result<(), RecordingError> {
        let mut state = self.state.write();
        if let Some(recorder) = &state.recorder {
            if let Err(error) = recorder.flush() {
                state.fault = Some(error.to_string());
                return Err(error);
            }
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
        let store = {
            let state = self.state.read();
            let recorder = state.recorder.as_ref().ok_or(RecordingError::Closed)?;
            if recorder.session().id == session_id {
                return Err(RecordingError::Invalid(
                    "the current recording session cannot be deleted".into(),
                ));
            }
            recorder.store().clone()
        };
        store.delete_session(session_id)
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
