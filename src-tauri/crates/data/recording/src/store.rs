//! Recording store handle — coordinates plus the selected engine.
//!
//! The handle owns no database type. It keeps the path, the engine chosen at
//! construction, and the optional read-path handle that routes reads through the
//! writer task's single connection; every statement goes to
//! [`StoreSession`](crate::port::StoreSession).
//!
//! The port is async, but this handle's surface is synchronous: callers that run
//! outside a runtime (the opening thread, tests, benchmarks) drive the engine
//! through [`crate::block_on`], and readers attached to a writer thread never
//! touch the engine at all. Only the writer task awaits the port directly.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::backend::default_engine;
use crate::port::{StoreEngine, StoreSession};
use crate::writer::{QueryCancellation, RecordingReader};
use crate::{DisplayBinding, RecordingError, SessionInfo, SessionState, StoredBatch};

#[derive(Debug, Clone)]
pub struct RecordingStore {
    path: PathBuf,
    /// The selected engine — the one place a backend enters this crate.
    engine: Arc<dyn StoreEngine>,
    /// Read-path handle — with it every read (query / export / session checks)
    /// runs on the writer task's **single** connection; `None` means no writer is
    /// attached yet (construction, repair, tests that open directly) and reads
    /// degrade to a private connection.
    reader: Option<RecordingReader>,
}

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
    pub fn open(path: impl AsRef<Path>) -> Result<Self, RecordingError> {
        Self::open_checked(path).map(|(store, _rebuilt)| store)
    }

    /// [`Self::open`] with the recovery note — `Some` means this open triggered
    /// an automatic recovery: a damaged catalog rebuilds (readable rows move into
    /// the new database), file-level damage quarantines the original and starts a
    /// new empty database.
    ///
    /// The engine decides how damage is classified and repaired; the caller only
    /// carries the note into the health report.
    pub(crate) fn open_checked(
        path: impl AsRef<Path>,
    ) -> Result<(Self, Option<String>), RecordingError> {
        let path = path.as_ref().to_path_buf();
        let engine = default_engine();
        let (session, note) = crate::block_on(engine.open(&path))?;
        // Verification happened on this session; closing it here matches the
        // previous behavior of opening and dropping a connection during
        // construction.
        drop(session);
        Ok((
            Self {
                path,
                engine,
                reader: None,
            },
            note,
        ))
    }

    /// Attach the read-path handle — provided by the writer task's channel.
    pub(crate) fn with_reader(mut self, reader: RecordingReader) -> Self {
        self.reader = Some(reader);
        self
    }

    /// The writer task's own copy: no read-path handle, so a read issued on the
    /// writer thread can never route back to itself.
    pub(crate) fn without_reader(&self) -> Self {
        Self {
            path: self.path.clone(),
            engine: Arc::clone(&self.engine),
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

    /// The selected engine, for the synchronous fallbacks that own no writer.
    pub(crate) fn engine(&self) -> &Arc<dyn StoreEngine> {
        &self.engine
    }

    /// A read/write session for the writer task, which awaits the port directly.
    pub(crate) async fn connect_async(&self) -> Result<Box<dyn StoreSession>, RecordingError> {
        self.engine.connect(&self.path).await
    }

    pub(crate) fn create_session(
        &self,
        bindings: &[DisplayBinding],
    ) -> Result<SessionInfo, RecordingError> {
        let engine = Arc::clone(&self.engine);
        let path = self.path.clone();
        crate::block_on(async move {
            let mut session = engine.connect(&path).await?;
            session.create_session(bindings).await
        })
    }

    pub(crate) fn reopen_session(
        &self,
        session_id: &str,
        state: SessionState,
    ) -> Result<SessionInfo, RecordingError> {
        let engine = Arc::clone(&self.engine);
        let path = self.path.clone();
        crate::block_on(async move {
            let mut session = engine.connect(&path).await?;
            session.reopen_session(session_id, state).await
        })
    }

    /// Startup continuation probe: the newest session's id when it holds no
    /// batches at all (see
    /// [`StoreSession::resumable_empty_session`](crate::port::StoreSession::resumable_empty_session)).
    pub(crate) fn resumable_empty_session(&self) -> Result<Option<String>, RecordingError> {
        let engine = Arc::clone(&self.engine);
        let path = self.path.clone();
        crate::block_on(async move {
            let mut session = engine.connect(&path).await?;
            session.resumable_empty_session().await
        })
    }

    /// Delete one session and its children.
    ///
    /// With a writer attached this goes over its **single** connection; without
    /// one (database closed, tests that open directly) it opens exclusively.
    /// Deleting at runtime still prefers
    /// [`RecordingHub::delete_session`](crate::RecordingHub::delete_session).
    pub fn delete_session(&self, session_id: &str) -> Result<(), RecordingError> {
        if let Some(reader) = self.reader() {
            return reader.delete_session(session_id);
        }
        let engine = Arc::clone(&self.engine);
        let path = self.path.clone();
        crate::block_on(async move {
            let mut session = engine.connect(&path).await?;
            session.delete_session(session_id).await
        })
    }

    /// Run one read-only SELECT and return rows as JSON objects.
    pub fn query_sql(&self, sql: &str, max_rows: usize) -> Result<SqlResult, RecordingError> {
        self.query_sql_cancellable(sql, max_rows, &Arc::new(QueryCancellation::default()))
    }

    /// [`Self::query_sql`] with a cancellation slot — the hub connects
    /// `cancel_query` to the running query through it.
    pub(crate) fn query_sql_cancellable(
        &self,
        sql: &str,
        max_rows: usize,
        cancellation: &Arc<QueryCancellation>,
    ) -> Result<SqlResult, RecordingError> {
        if let Some(reader) = self.reader() {
            return reader.sql(sql.to_string(), max_rows, Arc::clone(cancellation));
        }
        let engine = Arc::clone(&self.engine);
        let path = self.path.clone();
        let cancellation = Arc::clone(cancellation);
        let sql = sql.to_string();
        crate::block_on(async move {
            let mut session = engine.connect(&path).await?;
            session.query_sql(&sql, max_rows, &cancellation).await
        })
    }
}
