//! DuckDB engine — the current recording backend.
//!
//! Everything DuckDB-specific is confined to this module and
//! [`super::duckdb_sql`]: the connection, the session parameters, and the
//! recovery rules.

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use duckdb::Connection;

use super::duckdb_read_sql as read_sql;
use super::duckdb_sql as sql;
use crate::port::{StoreEngine, StoreSession};
use crate::writer::QueryCancellation;
use crate::{
    BindingInfo, DisplayBinding, HistoryPage, HistoryQuery, RecordBatch, RecordingCleanupResult,
    RecordingDatabaseInfo, RecordingError, SessionInfo, SessionState, SessionSummary, SqlResult,
};

/// DuckDB storage engine.
#[derive(Debug)]
pub struct DuckDbEngine;

#[async_trait]
impl StoreEngine for DuckDbEngine {
    async fn open(
        &self,
        path: &Path,
    ) -> Result<(Box<dyn StoreSession>, Option<String>), RecordingError> {
        // Opening is blocking and can stall on a locked file; it runs on the
        // blocking pool so the runtime and the caller's timeout stay responsive.
        let owned = path.to_path_buf();
        let opened = tokio::task::spawn_blocking(move || sql::open_checked(&owned))
            .await
            .map_err(open_task_failed)??;
        let (connection, note) = opened;
        Ok((Box::new(DuckDbSession::new(connection, path)), note))
    }

    async fn connect(&self, path: &Path) -> Result<Box<dyn StoreSession>, RecordingError> {
        let owned = path.to_path_buf();
        let connection = tokio::task::spawn_blocking(move || sql::connect(&owned))
            .await
            .map_err(open_task_failed)??;
        Ok(Box::new(DuckDbSession::new(connection, path)))
    }

    async fn connect_read_only(
        &self,
        path: &Path,
    ) -> Result<Box<dyn StoreSession>, RecordingError> {
        let owned = path.to_path_buf();
        let connection = tokio::task::spawn_blocking(move || sql::connect_read_only(&owned))
            .await
            .map_err(open_task_failed)??;
        Ok(Box::new(DuckDbSession::new(connection, path)))
    }
}

/// A panicked or cancelled blocking open still has to reach the caller as a
/// recording error rather than a panic in the runtime.
fn open_task_failed(error: tokio::task::JoinError) -> RecordingError {
    RecordingError::Failed(format!("recording database open task failed: {error}"))
}

/// One open DuckDB connection, owned by whoever holds the session.
///
/// The connection is `None` only while [`Self::rebuild`] has closed it.
pub struct DuckDbSession {
    connection: Option<Connection>,
    path: PathBuf,
}

impl DuckDbSession {
    fn new(connection: Connection, path: &Path) -> Self {
        Self {
            connection: Some(connection),
            path: path.to_path_buf(),
        }
    }

    /// The single handle, or the reason it is temporarily unavailable.
    fn handle(&self) -> Result<&Connection, RecordingError> {
        self.connection.as_ref().ok_or_else(|| {
            RecordingError::Failed("the recording database connection is closed".into())
        })
    }
}

#[async_trait]
impl StoreSession for DuckDbSession {
    async fn begin(&mut self) -> Result<(), RecordingError> {
        self.handle()?.execute_batch("BEGIN TRANSACTION")?;
        Ok(())
    }

    async fn commit(&mut self) -> Result<(), RecordingError> {
        self.handle()?.execute_batch("COMMIT")?;
        Ok(())
    }

    async fn next_row_id(&mut self) -> Result<i64, RecordingError> {
        sql::next_row_id(self.handle()?)
    }

    async fn create_session(
        &mut self,
        bindings: &[DisplayBinding],
    ) -> Result<SessionInfo, RecordingError> {
        sql::create_session(self.handle()?, bindings)
    }

    async fn reopen_session(
        &mut self,
        session_id: &str,
        state: SessionState,
    ) -> Result<SessionInfo, RecordingError> {
        sql::reopen_session(self.handle()?, session_id, state)
    }

    async fn resumable_empty_session(&mut self) -> Result<Option<String>, RecordingError> {
        sql::resumable_empty_session(self.handle()?)
    }

    async fn write_batch(
        &mut self,
        session_id: &str,
        row_id: i64,
        batch: &RecordBatch,
    ) -> Result<usize, RecordingError> {
        sql::write_batch(self.handle()?, session_id, row_id, batch)
    }

    async fn insert_binding(
        &mut self,
        session_id: &str,
        binding: &DisplayBinding,
    ) -> Result<(), RecordingError> {
        sql::insert_binding(self.handle()?, session_id, binding)
    }

    async fn close_binding(
        &mut self,
        session_id: &str,
        binding_id: &str,
    ) -> Result<(), RecordingError> {
        sql::close_binding(self.handle()?, session_id, binding_id)
    }

    async fn update_session(
        &mut self,
        session_id: &str,
        state: SessionState,
    ) -> Result<(), RecordingError> {
        sql::update_session(self.handle()?, session_id, state)
    }

    async fn list_sessions(&mut self) -> Result<Vec<SessionInfo>, RecordingError> {
        read_sql::list_sessions(self.handle()?)
    }

    async fn list_session_summaries(&mut self) -> Result<Vec<SessionSummary>, RecordingError> {
        read_sql::list_session_summaries(self.handle()?)
    }

    async fn session_is_empty(&mut self, session_id: &str) -> Result<bool, RecordingError> {
        read_sql::session_is_empty(self.handle()?, session_id)
    }

    async fn list_bindings(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<BindingInfo>, RecordingError> {
        read_sql::list_bindings(self.handle()?, session_id)
    }

    async fn database_info(&mut self) -> Result<RecordingDatabaseInfo, RecordingError> {
        read_sql::database_info(self.handle()?, &self.path)
    }

    async fn history_page(&mut self, query: &HistoryQuery) -> Result<HistoryPage, RecordingError> {
        read_sql::history_page(self.handle()?, query)
    }

    async fn query_sql(
        &mut self,
        statement: &str,
        max_rows: usize,
        cancellation: &QueryCancellation,
    ) -> Result<SqlResult, RecordingError> {
        let connection = self.handle()?;
        // Cancellation applies to the query running on this connection; a
        // cancellation that arrives first is remembered by the slot.
        cancellation.attach(connection.interrupt_handle());
        let result = read_sql::query_sql(connection, statement, max_rows);
        cancellation.detach();
        result
    }

    async fn delete_session(&mut self, session_id: &str) -> Result<(), RecordingError> {
        sql::delete_session(self.handle()?, session_id)
    }

    async fn delete_sessions(
        &mut self,
        current_session_id: &str,
        session_ids: &[String],
    ) -> Result<RecordingCleanupResult, RecordingError> {
        sql::delete_sessions(self.handle()?, current_session_id, session_ids)
    }

    async fn rebuild(&mut self) -> Result<PathBuf, RecordingError> {
        self.connection = None;
        let outcome = crate::repair::rebuild_database(&self.path);
        self.connection = Some(sql::connect(&self.path)?);
        outcome
    }

    /// The retry condition the writer uses after a failed cleanup: only the
    /// catalog damage that rebuilding heals.
    fn is_recoverable(&self, error: &RecordingError) -> bool {
        crate::repair::is_catalog_damage(error)
    }
}
