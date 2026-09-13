//! Recorder construction for write-target swaps (same split as `writer/worker`).

use std::collections::HashMap;
use std::path::Path;
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
