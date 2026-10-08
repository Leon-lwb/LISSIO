//! SeaORM engine — the connection, schema, and session layer for the SQLite
//! replacement backend.
//!
//! SQLite is the first engine: it keeps the embedded, offline-first default while
//! the same code path addresses PostgreSQL and MySQL by URL. Schema statements go
//! through `sea_query` builders rather than hand-written DDL so column types and
//! the composite primary key render per dialect.
//!
//! Everything engine-specific is confined to this module and its helpers:
//! [`super::sea_sql`] owns the write SQL and the value codecs,
//! [`super::sea_read_sql`] the read SQL, and [`super::sea_cleanup`] the delete
//! policy. The store port never sees a `DatabaseConnection`.
//!
//! Unlike DuckDB there is no automatic repair to report: SQLite validates its own
//! file format, so [`SeaOrmEngine::open`] never returns a recovery note, and
//! [`SeaOrmSession::is_recoverable`] answers `false` — the writer's
//! rebuild-then-retry path is a no-op for this engine.

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use sea_orm::sea_query::{Alias, ColumnDef, Index, Table, TableCreateStatement};
use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbErr};

use super::{sea_cleanup, sea_read_sql, sea_sql};
use crate::port::{StoreEngine, StoreSession};
use crate::writer::QueryCancellation;
use crate::{
    BindingInfo, DisplayBinding, HistoryPage, HistoryQuery, RecordBatch, RecordingCleanupResult,
    RecordingDatabaseInfo, RecordingError, SessionInfo, SessionState, SessionSummary, SqlResult,
};

/// Connection URL for the SQLite file at `path`.
///
/// The writer is the only client, so the pool is capped at one connection in
/// [`connect_and_initialize`]; that cap is also what makes an explicit
/// `BEGIN`/`COMMIT` pair land on the same connection.
///
/// `mode=rwc` creates the file on first use, which matches the store's
/// "open (creating when needed)" contract.
pub fn sqlite_url(path: &Path) -> String {
    format!("sqlite://{}?mode=rwc", path.display())
}

/// Connection URL for a read-only open.
///
/// `mode=ro` makes SQLite refuse every write at the file layer, which is what
/// the store wants for a path it opened before a writer attached.
pub fn sqlite_read_only_url(path: &Path) -> String {
    format!("sqlite://{}?mode=ro", path.display())
}

/// Open the database at `url` and create every table the store needs.
pub async fn connect_and_initialize(url: &str) -> Result<DatabaseConnection, DbErr> {
    let mut options = ConnectOptions::new(url.to_owned());
    // One connection: the store serializes every statement on the writer task,
    // and a transaction must not hop between pooled connections.
    options.max_connections(1);
    let connection = Database::connect(options).await?;
    let backend = connection.get_database_backend();
    for statement in schema_statements() {
        connection.execute_raw(backend.build(&statement)).await?;
    }
    for statement in schema_indexes() {
        connection.execute_raw(backend.build(&statement)).await?;
    }
    Ok(connection)
}

/// Every table, in creation order.
///
/// Types stay deliberately coarse — `string`, `big_integer`, `blob` — so one
/// definition renders as SQLite `TEXT`/`INTEGER`/`BLOB` and as the equivalent
/// PostgreSQL or MySQL column without a dialect branch.
pub fn schema_statements() -> Vec<TableCreateStatement> {
    vec![
        Table::create()
            .table(Alias::new("recording_sessions"))
            .if_not_exists()
            .col(
                ColumnDef::new(Alias::new("id"))
                    .string()
                    .not_null()
                    .primary_key(),
            )
            .col(
                ColumnDef::new(Alias::new("started_at_us"))
                    .big_integer()
                    .not_null(),
            )
            .col(ColumnDef::new(Alias::new("ended_at_us")).big_integer())
            .col(ColumnDef::new(Alias::new("state")).string().not_null())
            .to_owned(),
        Table::create()
            .table(Alias::new("display_bindings"))
            .if_not_exists()
            .col(ColumnDef::new(Alias::new("id")).string().not_null())
            .col(ColumnDef::new(Alias::new("session_id")).string().not_null())
            .col(
                ColumnDef::new(Alias::new("component_id"))
                    .string()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("source_node_id"))
                    .string()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("source_handle"))
                    .string()
                    .not_null(),
            )
            .col(ColumnDef::new(Alias::new("domain")).string().not_null())
            .col(ColumnDef::new(Alias::new("capability")).string().not_null())
            .col(
                ColumnDef::new(Alias::new("bound_at_us"))
                    .big_integer()
                    .not_null(),
            )
            .col(ColumnDef::new(Alias::new("unbound_at_us")).big_integer())
            .primary_key(
                Index::create()
                    .col(Alias::new("session_id"))
                    .col(Alias::new("id")),
            )
            .to_owned(),
        Table::create()
            .table(Alias::new("recording_batches"))
            .if_not_exists()
            .col(
                ColumnDef::new(Alias::new("row_id"))
                    .big_integer()
                    .not_null()
                    .primary_key(),
            )
            .col(ColumnDef::new(Alias::new("session_id")).string().not_null())
            .col(ColumnDef::new(Alias::new("binding_id")).string().not_null())
            .col(ColumnDef::new(Alias::new("domain")).string().not_null())
            .col(ColumnDef::new(Alias::new("epoch")).big_integer().not_null())
            .col(
                ColumnDef::new(Alias::new("sequence_start"))
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("sequence_end"))
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("first_timestamp_us"))
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("last_timestamp_us"))
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("item_count"))
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("effective_bytes"))
                    .big_integer()
                    .not_null(),
            )
            .col(
                ColumnDef::new(Alias::new("checksum"))
                    .big_integer()
                    .not_null(),
            )
            .col(ColumnDef::new(Alias::new("payload")).blob().not_null())
            .col(
                ColumnDef::new(Alias::new("committed_at_us"))
                    .big_integer()
                    .not_null(),
            )
            .to_owned(),
    ]
}

/// Indexes are created separately so a failed one never blocks the tables.
pub fn schema_indexes() -> Vec<sea_orm::sea_query::IndexCreateStatement> {
    vec![
        Index::create()
            .name("recording_time_idx")
            .table(Alias::new("recording_batches"))
            .col(Alias::new("session_id"))
            .col(Alias::new("binding_id"))
            .col(Alias::new("first_timestamp_us"))
            .if_not_exists()
            .to_owned(),
    ]
}

/// SeaORM storage engine.
#[derive(Debug)]
pub struct SeaOrmEngine;

#[async_trait]
impl StoreEngine for SeaOrmEngine {
    /// Open (creating when needed) the database and return its session.
    ///
    /// The note is always `None`: DuckDB classifies and repairs catalog damage
    /// during an open, while SQLite validates its own file and needs no such
    /// step, so there is nothing for this engine to report on the warning
    /// channel. Orphaned `running`/`paused` sessions are still closed here —
    /// that is crash recovery shared by both engines, not catalog repair.
    async fn open(
        &self,
        path: &Path,
    ) -> Result<(Box<dyn StoreSession>, Option<String>), RecordingError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection = connect_and_initialize(&sqlite_url(path))
            .await
            .map_err(sea_sql::database_error)?;
        sea_sql::mark_orphaned_sessions(&connection).await?;
        Ok((Box::new(SeaOrmSession::new(connection, path)), None))
    }

    async fn connect(&self, path: &Path) -> Result<Box<dyn StoreSession>, RecordingError> {
        let connection = connect_and_initialize(&sqlite_url(path))
            .await
            .map_err(sea_sql::database_error)?;
        Ok(Box::new(SeaOrmSession::new(connection, path)))
    }

    /// Open for reading only. The schema is assumed to exist: a read-only open
    /// cannot create it, and the store only takes this path on a database it
    /// opened for writing first.
    async fn connect_read_only(
        &self,
        path: &Path,
    ) -> Result<Box<dyn StoreSession>, RecordingError> {
        let mut options = ConnectOptions::new(sqlite_read_only_url(path));
        options.max_connections(1);
        let connection = Database::connect(options)
            .await
            .map_err(sea_sql::database_error)?;
        Ok(Box::new(SeaOrmSession::new(connection, path)))
    }
}

/// One open SeaORM connection, owned by whoever holds the session.
///
/// The connection is `None` only while [`SeaOrmSession::rebuild`] has closed it.
pub struct SeaOrmSession {
    connection: Option<DatabaseConnection>,
    path: PathBuf,
}

impl SeaOrmSession {
    fn new(connection: DatabaseConnection, path: &Path) -> Self {
        Self {
            connection: Some(connection),
            path: path.to_path_buf(),
        }
    }

    /// The single handle, or the reason it is temporarily unavailable.
    fn handle(&self) -> Result<&DatabaseConnection, RecordingError> {
        self.connection.as_ref().ok_or_else(|| {
            RecordingError::Failed("the recording database connection is closed".into())
        })
    }
}

#[async_trait]
impl StoreSession for SeaOrmSession {
    /// `BEGIN`/`COMMIT` go through unprepared SQL rather than SeaORM's
    /// transaction object so the writer keeps driving one flat statement stream;
    /// the one-connection pool makes that stream land on a single connection.
    async fn begin(&mut self) -> Result<(), RecordingError> {
        self.handle()?
            .execute_unprepared("BEGIN")
            .await
            .map_err(sea_sql::database_error)?;
        Ok(())
    }

    async fn commit(&mut self) -> Result<(), RecordingError> {
        self.handle()?
            .execute_unprepared("COMMIT")
            .await
            .map_err(sea_sql::database_error)?;
        Ok(())
    }

    async fn next_row_id(&mut self) -> Result<i64, RecordingError> {
        sea_sql::next_row_id(self.handle()?).await
    }

    async fn create_session(
        &mut self,
        bindings: &[DisplayBinding],
    ) -> Result<SessionInfo, RecordingError> {
        sea_sql::create_session(self.handle()?, bindings).await
    }

    async fn reopen_session(
        &mut self,
        session_id: &str,
        state: SessionState,
    ) -> Result<SessionInfo, RecordingError> {
        sea_sql::reopen_session(self.handle()?, session_id, state).await
    }

    async fn resumable_empty_session(&mut self) -> Result<Option<String>, RecordingError> {
        sea_sql::resumable_empty_session(self.handle()?).await
    }

    async fn write_batch(
        &mut self,
        session_id: &str,
        row_id: i64,
        batch: &RecordBatch,
    ) -> Result<usize, RecordingError> {
        sea_sql::write_batch(self.handle()?, session_id, row_id, batch).await
    }

    async fn insert_binding(
        &mut self,
        session_id: &str,
        binding: &DisplayBinding,
    ) -> Result<(), RecordingError> {
        sea_sql::insert_binding(self.handle()?, session_id, binding).await
    }

    async fn close_binding(
        &mut self,
        session_id: &str,
        binding_id: &str,
    ) -> Result<(), RecordingError> {
        sea_sql::close_binding(self.handle()?, session_id, binding_id).await
    }

    async fn update_session(
        &mut self,
        session_id: &str,
        state: SessionState,
    ) -> Result<(), RecordingError> {
        sea_sql::update_session(self.handle()?, session_id, state).await
    }

    async fn list_sessions(&mut self) -> Result<Vec<SessionInfo>, RecordingError> {
        sea_read_sql::list_sessions(self.handle()?).await
    }

    async fn list_session_summaries(&mut self) -> Result<Vec<SessionSummary>, RecordingError> {
        sea_read_sql::list_session_summaries(self.handle()?).await
    }

    async fn session_is_empty(&mut self, session_id: &str) -> Result<bool, RecordingError> {
        sea_read_sql::session_is_empty(self.handle()?, session_id).await
    }

    async fn list_bindings(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<BindingInfo>, RecordingError> {
        sea_read_sql::list_bindings(self.handle()?, session_id).await
    }

    async fn database_info(&mut self) -> Result<RecordingDatabaseInfo, RecordingError> {
        sea_read_sql::database_info(self.handle()?, &self.path).await
    }

    async fn history_page(&mut self, query: &HistoryQuery) -> Result<HistoryPage, RecordingError> {
        sea_read_sql::history_page(self.handle()?, query).await
    }

    /// The cancellation slot carries a DuckDB interrupt handle; sqlx offers no
    /// per-query interrupt, so this engine cannot honor a cancel and runs the
    /// query to completion.
    async fn query_sql(
        &mut self,
        statement: &str,
        max_rows: usize,
        _cancellation: &QueryCancellation,
    ) -> Result<SqlResult, RecordingError> {
        sea_read_sql::query_sql(self.handle()?, statement, max_rows).await
    }

    async fn delete_session(&mut self, session_id: &str) -> Result<(), RecordingError> {
        sea_cleanup::delete_session(self.handle()?, session_id).await
    }

    async fn delete_sessions(
        &mut self,
        current_session_id: &str,
        session_ids: &[String],
    ) -> Result<RecordingCleanupResult, RecordingError> {
        sea_cleanup::delete_sessions(self.handle()?, current_session_id, session_ids).await
    }

    /// SQLite has no separate catalog to re-export, so "rebuild" can only mean:
    /// drop the handle and reopen the same file. The returned path is that live
    /// file — DuckDB returns the damaged copy it moved aside instead.
    async fn rebuild(&mut self) -> Result<PathBuf, RecordingError> {
        self.connection = None;
        let connection = connect_and_initialize(&sqlite_url(&self.path))
            .await
            .map_err(sea_sql::database_error)?;
        self.connection = Some(connection);
        Ok(self.path.clone())
    }

    /// SQLite never reports the DuckDB catalog-invalidation damage that a
    /// rebuild heals, so no error here is worth a rebuild-and-retry.
    fn is_recoverable(&self, _error: &RecordingError) -> bool {
        false
    }
}
