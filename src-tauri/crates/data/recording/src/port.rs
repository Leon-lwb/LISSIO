//! Storage backend port — the engine boundary of the recording store.
//!
//! [`RecordingStore`](crate::RecordingStore) owns coordinates only: the database
//! path, the selected engine, and the optional reader handle that routes reads
//! through the writer thread. Every database operation delegates to
//! [`StoreEngine`] and [`StoreSession`], so no module above this one names an
//! engine type: adding a backend is one more implementation plus one selection
//! point in [`crate::backend`].
//!
//! The port is async because a remote engine's I/O is async. Callers that run
//! outside a runtime (construction on the opening thread, tests, benchmarks)
//! drive these futures with [`crate::block_on`]; the writer thread owns a
//! runtime of its own and awaits them directly.

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use serde::Serialize;

use crate::writer::QueryCancellation;
use crate::{
    BindingInfo, DisplayBinding, HistoryPage, HistoryQuery, RecordBatch, RecordingCleanupResult,
    RecordingDatabaseInfo, RecordingError, SessionInfo, SessionState, SessionSummary, SqlResult,
};

/// One row of an export stream.
///
/// The shape is engine-independent: CSV and JSON write it directly.
#[derive(Debug, Clone, Serialize)]
pub struct ExportRow {
    pub session_id: String,
    pub binding_id: String,
    pub domain: String,
    pub row_id: i64,
    pub sequence: u64,
    pub first_timestamp_us: u64,
    pub last_timestamp_us: u64,
    pub index: u64,
    pub value: Option<f64>,
    pub text: Option<String>,
    pub frequency: Option<f64>,
}

/// Engine-owned handle to one open recording database.
///
/// A session is deliberately neither `Sync` nor shared: the writer task owns
/// exactly one and executes every statement on it, which is what keeps a single
/// connection authoritative.
#[async_trait]
pub trait StoreSession: Send {
    /// Open the write transaction that batches appends.
    async fn begin(&mut self) -> Result<(), RecordingError>;
    /// Commit the open transaction. Committing without one open is an error.
    async fn commit(&mut self) -> Result<(), RecordingError>;
    /// Next free batch row id.
    async fn next_row_id(&mut self) -> Result<i64, RecordingError>;
    /// Create a session row plus its initial bindings.
    async fn create_session(
        &mut self,
        bindings: &[DisplayBinding],
    ) -> Result<SessionInfo, RecordingError>;
    /// Resume a stopped session: clear its end timestamp and store `state`.
    async fn reopen_session(
        &mut self,
        session_id: &str,
        state: SessionState,
    ) -> Result<SessionInfo, RecordingError>;
    /// Id of the newest session when it holds no batches at all.
    async fn resumable_empty_session(&mut self) -> Result<Option<String>, RecordingError>;
    /// Append one batch and return its effective byte count.
    async fn write_batch(
        &mut self,
        session_id: &str,
        row_id: i64,
        batch: &RecordBatch,
    ) -> Result<usize, RecordingError>;
    /// Insert or refresh a display binding.
    async fn insert_binding(
        &mut self,
        session_id: &str,
        binding: &DisplayBinding,
    ) -> Result<(), RecordingError>;
    /// Mark a display binding as unbound.
    async fn close_binding(
        &mut self,
        session_id: &str,
        binding_id: &str,
    ) -> Result<(), RecordingError>;
    /// Store a session state and set or clear its end timestamp.
    async fn update_session(
        &mut self,
        session_id: &str,
        state: SessionState,
    ) -> Result<(), RecordingError>;
    /// Every session, newest first.
    async fn list_sessions(&mut self) -> Result<Vec<SessionInfo>, RecordingError>;
    /// Every session with its aggregated batch totals, newest first.
    async fn list_session_summaries(&mut self) -> Result<Vec<SessionSummary>, RecordingError>;
    /// Whether the session holds no batches at all.
    async fn session_is_empty(&mut self, session_id: &str) -> Result<bool, RecordingError>;
    /// Every display binding of one session.
    async fn list_bindings(&mut self, session_id: &str)
    -> Result<Vec<BindingInfo>, RecordingError>;
    /// Database counters plus the file size of this session's path.
    async fn database_info(&mut self) -> Result<RecordingDatabaseInfo, RecordingError>;
    /// One page of stored batches.
    async fn history_page(&mut self, query: &HistoryQuery) -> Result<HistoryPage, RecordingError>;
    /// One read-only `SELECT`/`WITH`, cancellable through `cancellation`.
    async fn query_sql(
        &mut self,
        sql: &str,
        max_rows: usize,
        cancellation: &QueryCancellation,
    ) -> Result<SqlResult, RecordingError>;
    /// Delete one session and its children.
    async fn delete_session(&mut self, session_id: &str) -> Result<(), RecordingError>;
    /// Delete many sessions, skipping the ones a delete must never touch.
    async fn delete_sessions(
        &mut self,
        current_session_id: &str,
        session_ids: &[String],
    ) -> Result<RecordingCleanupResult, RecordingError>;
    /// Close the current handle, rebuild the database file, and reopen it.
    async fn rebuild(&mut self) -> Result<PathBuf, RecordingError>;
    /// Whether `error` is damage this engine heals by rebuilding.
    fn is_recoverable(&self, error: &RecordingError) -> bool;
}

/// Opens sessions for one engine and owns every engine-specific recovery rule.
#[async_trait]
pub trait StoreEngine: Send + Sync + std::fmt::Debug {
    /// Open (creating when needed) the database at `path`.
    ///
    /// `Ok((session, Some(note)))` reports an automatic recovery that the caller
    /// must surface as a warning: engine damage is classified and repaired here
    /// rather than by the caller.
    async fn open(
        &self,
        path: &Path,
    ) -> Result<(Box<dyn StoreSession>, Option<String>), RecordingError>;
    /// Open `path` for reading and writing without verification or recovery.
    async fn connect(&self, path: &Path) -> Result<Box<dyn StoreSession>, RecordingError>;
    /// Open `path` read-only for paths that own no writer thread.
    async fn connect_read_only(&self, path: &Path)
    -> Result<Box<dyn StoreSession>, RecordingError>;
}
