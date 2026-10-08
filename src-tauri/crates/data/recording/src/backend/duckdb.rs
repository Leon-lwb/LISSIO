//! DuckDB engine — the current recording backend.
//!
//! Everything DuckDB-specific is confined to this module and
//! [`super::duckdb_sql`]: the connection, the session parameters, and the
//! recovery rules.

use std::path::{Path, PathBuf};

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

impl StoreEngine for DuckDbEngine {
    fn open(&self, path: &Path) -> Result<(Box<dyn StoreSession>, Option<String>), RecordingError> {
        let (connection, note) = sql::open_checked(path)?;
        Ok((Box::new(DuckDbSession::new(connection, path)), note))
    }

    fn connect(&self, path: &Path) -> Result<Box<dyn StoreSession>, RecordingError> {
        Ok(Box::new(DuckDbSession::new(sql::connect(path)?, path)))
    }

    fn connect_read_only(&self, path: &Path) -> Result<Box<dyn StoreSession>, RecordingError> {
        Ok(Box::new(DuckDbSession::new(
            sql::connect_read_only(path)?,
            path,
        )))
    }
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

impl StoreSession for DuckDbSession {
    fn begin(&mut self) -> Result<(), RecordingError> {
        self.handle()?.execute_batch("BEGIN TRANSACTION")?;
        Ok(())
    }

    fn commit(&mut self) -> Result<(), RecordingError> {
        self.handle()?.execute_batch("COMMIT")?;
        Ok(())
    }

    fn next_row_id(&mut self) -> Result<i64, RecordingError> {
        sql::next_row_id(self.handle()?)
    }

    fn create_session(
        &mut self,
        bindings: &[DisplayBinding],
    ) -> Result<SessionInfo, RecordingError> {
        sql::create_session(self.handle()?, bindings)
    }

    fn reopen_session(
        &mut self,
        session_id: &str,
        state: SessionState,
    ) -> Result<SessionInfo, RecordingError> {
        sql::reopen_session(self.handle()?, session_id, state)
    }

    fn resumable_empty_session(&mut self) -> Result<Option<String>, RecordingError> {
        sql::resumable_empty_session(self.handle()?)
    }

    fn write_batch(
        &mut self,
        session_id: &str,
        row_id: i64,
        batch: &RecordBatch,
    ) -> Result<usize, RecordingError> {
        sql::write_batch(self.handle()?, session_id, row_id, batch)
    }

    fn insert_binding(
        &mut self,
        session_id: &str,
        binding: &DisplayBinding,
    ) -> Result<(), RecordingError> {
        sql::insert_binding(self.handle()?, session_id, binding)
    }

    fn close_binding(&mut self, session_id: &str, binding_id: &str) -> Result<(), RecordingError> {
        sql::close_binding(self.handle()?, session_id, binding_id)
    }

    fn update_session(
        &mut self,
        session_id: &str,
        state: SessionState,
    ) -> Result<(), RecordingError> {
        sql::update_session(self.handle()?, session_id, state)
    }

    fn list_sessions(&mut self) -> Result<Vec<SessionInfo>, RecordingError> {
        read_sql::list_sessions(self.handle()?)
    }

    fn list_session_summaries(&mut self) -> Result<Vec<SessionSummary>, RecordingError> {
        read_sql::list_session_summaries(self.handle()?)
    }

    fn session_is_empty(&mut self, session_id: &str) -> Result<bool, RecordingError> {
        read_sql::session_is_empty(self.handle()?, session_id)
    }

    fn list_bindings(&mut self, session_id: &str) -> Result<Vec<BindingInfo>, RecordingError> {
        read_sql::list_bindings(self.handle()?, session_id)
    }

    fn database_info(&mut self) -> Result<RecordingDatabaseInfo, RecordingError> {
        read_sql::database_info(self.handle()?, &self.path)
    }

    fn history_page(&mut self, query: &HistoryQuery) -> Result<HistoryPage, RecordingError> {
        read_sql::history_page(self.handle()?, query)
    }

    fn query_sql(
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

    fn delete_session(&mut self, session_id: &str) -> Result<(), RecordingError> {
        sql::delete_session(self.handle()?, session_id)
    }

    fn delete_sessions(
        &mut self,
        current_session_id: &str,
        session_ids: &[String],
    ) -> Result<RecordingCleanupResult, RecordingError> {
        sql::delete_sessions(self.handle()?, current_session_id, session_ids)
    }

    fn rebuild(&mut self) -> Result<PathBuf, RecordingError> {
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
