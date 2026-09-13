//! Recorder construction for write-target swaps (same split as `writer/worker`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::{
    DisplayBinding, PortIdentity, Recorder, RecordingError, RecordingLimits, RecordingStore,
    SessionState,
};

/// Write target for a recorder swap: a brand-new session, an explicitly named
/// session, or the startup path that continues the newest session while it
/// stays empty.
#[derive(Debug, Clone)]
pub(super) enum RecordingTarget {
    New,
    Resume(String),
    ContinueEmpty,
}

/// Build a recorder for `target`, resuming into `initial`. The caller must
/// ensure no other database instance is open. `ContinueEmpty` resolves against
/// the freshly opened store: the newest empty session (crash leftovers
/// included) is reopened, otherwise a new session is created.
pub(super) fn spawn_recorder(
    path: &Path,
    limits: RecordingLimits,
    active: HashMap<PortIdentity, DisplayBinding>,
    target: RecordingTarget,
    initial: SessionState,
) -> Result<Arc<Recorder>, RecordingError> {
    let store = RecordingStore::open(path)?;
    let bindings = active.values().cloned().collect();
    let resumed = match target {
        RecordingTarget::ContinueEmpty => match store.resumable_empty_session()? {
            Some(session_id) => Some(store.reopen_session(&session_id, initial)?),
            None => None,
        },
        RecordingTarget::Resume(session_id) => Some(store.reopen_session(&session_id, initial)?),
        RecordingTarget::New => None,
    };
    let recorder = match resumed {
        Some(session) => Recorder::attach(store, session, bindings, limits)?,
        None => Recorder::start(store, bindings, limits)?,
    };
    if initial != SessionState::Running {
        recorder.set_state(initial)?;
    }
    Ok(Arc::new(recorder))
}

/// Apply persisted storage preferences replayed from settings: the database
/// path and the empty-session continuation toggle. Swaps the recorder only
/// when the effective target differs — another database path, or continuation
/// disabled while the boot-resumed session is still empty. Returns whether a
/// swap happened. The caller must ensure the run is paused or stopped (see
/// `replace_recording`).
pub(super) fn apply_settings(
    hub: &super::RecordingHub,
    database_path: Option<PathBuf>,
    continue_empty: bool,
    initial: SessionState,
) -> Result<bool, RecordingError> {
    let (current_path, limits, active) = hub.database_and_bindings()?;
    let target_path = database_path.unwrap_or_else(|| current_path.clone());
    if target_path != current_path {
        let target = if continue_empty {
            RecordingTarget::ContinueEmpty
        } else {
            RecordingTarget::New
        };
        hub.replace_recording(&target_path, limits, active, target, initial)?;
        return Ok(true);
    }
    // Continuation disabled: abandon the boot-resumed session while it still
    // holds no batches, restoring one-session-per-start behavior.
    if !continue_empty && current_session_is_empty(hub)? {
        hub.replace_recording(&target_path, limits, active, RecordingTarget::New, initial)?;
        return Ok(true);
    }
    Ok(false)
}

/// Whether the active session holds no batches, queried on the hub's store.
fn current_session_is_empty(hub: &super::RecordingHub) -> Result<bool, RecordingError> {
    let query = {
        let state = hub.state.read();
        state
            .recorder
            .as_ref()
            .map(|recorder| (recorder.store().clone(), recorder.session().id.clone()))
    };
    match query {
        Some((store, session_id)) => store.session_is_empty(&session_id),
        None => Ok(false),
    }
}
