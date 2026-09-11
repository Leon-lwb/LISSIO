use std::path::{Path, PathBuf};

use duckdb::types::ValueRef;
use duckdb::{AccessMode, Config, Connection, params};
use serde::{Deserialize, Serialize};

use crate::codec;
use crate::{
    BatchPayload, DisplayBinding, Domain, HistoryQuery, RecordBatch, RecordingError, SessionInfo,
    SessionState, StoredBatch,
};

#[derive(Debug, Clone)]
pub struct RecordingStore {
    path: PathBuf,
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
    pub fn open(path: impl AsRef<Path>) -> Result<Self, RecordingError> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let store = Self { path };
        let connection = store.connect()?;
        initialize(&connection)?;
        // A process crash cannot have committed data after the final transaction.
        // Mark orphaned sessions explicitly while retaining their last valid commit.
        connection.execute(
            "UPDATE recording_sessions SET state='failed', ended_at_us=? \
             WHERE state IN ('running', 'paused')",
            params![now_us()],
        )?;
        Ok(store)
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn connect(&self) -> Result<Connection, RecordingError> {
        let connection = Connection::open(&self.path)?;
        connection.execute_batch(
            "SET preserve_insertion_order=false; SET threads=4; SET checkpoint_threshold='256 MiB';",
        )?;
        Ok(connection)
    }

    pub(crate) fn connect_read_only(&self) -> Result<Connection, RecordingError> {
        let config = Config::default()
            .access_mode(AccessMode::ReadOnly)?
            .enable_external_access(false)?;
        let connection = Connection::open_with_flags(&self.path, config)?;
        connection.execute_batch("SET threads=4;")?;
        Ok(connection)
    }

    pub(crate) fn create_session(
        &self,
        bindings: &[DisplayBinding],
    ) -> Result<SessionInfo, RecordingError> {
        let connection = self.connect()?;
        let started_at_us = now_us();
        let id = format!("{started_at_us}-{}", std::process::id());
        connection.execute_batch("BEGIN TRANSACTION")?;
        let result = (|| {
            connection.execute(
                "INSERT INTO recording_sessions(id, started_at_us, state) VALUES (?, ?, 'running')",
                params![&id, started_at_us],
            )?;
            for binding in bindings {
                insert_binding(&connection, &id, binding)?;
            }
            connection.execute_batch("COMMIT")?;
            Ok(SessionInfo {
                id,
                started_at_us,
                ended_at_us: None,
                state: SessionState::Running,
            })
        })();
        if result.is_err() {
            let _ = connection.execute_batch("ROLLBACK");
        }
        result
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionInfo>, RecordingError> {
        let connection = self.connect_read_only()?;
        let mut statement = connection.prepare(
            "SELECT id, started_at_us, ended_at_us, state FROM recording_sessions \
             ORDER BY started_at_us DESC",
        )?;
        let rows = statement.query_map([], |row| {
            let state: String = row.get(3)?;
            Ok(SessionInfo {
                id: row.get(0)?,
                started_at_us: row.get(1)?,
                ended_at_us: row.get(2)?,
                state: parse_state(&state),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn delete_session(&self, session_id: &str) -> Result<(), RecordingError> {
        let connection = self.connect()?;
        let state: String = connection
            .query_row(
                "SELECT state FROM recording_sessions WHERE id=?",
                params![session_id],
                |row| row.get(0),
            )
            .map_err(|error| match error {
                duckdb::Error::QueryReturnedNoRows => {
                    RecordingError::Invalid("recording session was not found".into())
                }
                other => other.into(),
            })?;
        if matches!(
            parse_state(&state),
            SessionState::Running | SessionState::Paused
        ) {
            return Err(RecordingError::Invalid(
                "an active recording session cannot be deleted".into(),
            ));
        }
        connection.execute(
            "DELETE FROM recording_batches WHERE session_id=?",
            params![session_id],
        )?;
        connection.execute(
            "DELETE FROM display_bindings WHERE session_id=?",
            params![session_id],
        )?;
        connection.execute(
            "DELETE FROM recording_sessions WHERE id=?",
            params![session_id],
        )?;
        Ok(())
    }

    pub fn history_page(
        &self,
        session_id: &str,
        binding_id: Option<&str>,
        after_row_id: i64,
        limit: usize,
        include_payload: bool,
    ) -> Result<HistoryPage, RecordingError> {
        self.history_page_query(&HistoryQuery {
            session_id: session_id.to_string(),
            binding_id: binding_id.map(ToString::to_string),
            after_row_id,
            from_us: None,
            to_us: None,
            limit,
            include_payload,
        })
    }

    /// Run one read-only SELECT and return rows as JSON objects.
    pub fn query_sql(&self, sql: &str, max_rows: usize) -> Result<SqlResult, RecordingError> {
        let connection = self.connect_read_only()?;
        Self::query_sql_on(&connection, sql, max_rows)
    }

    pub(crate) fn query_sql_on(
        connection: &Connection,
        sql: &str,
        max_rows: usize,
    ) -> Result<SqlResult, RecordingError> {
        let normalized = sql.trim_start().to_ascii_lowercase();
        if !(normalized.starts_with("select ") || normalized.starts_with("with "))
            || sql.contains(';')
        {
            return Err(RecordingError::Invalid(
                "historical SQL must be one SELECT or WITH query".into(),
            ));
        }
        let max_rows = max_rows.clamp(1, 100_000);
        let wrapped = format!(
            "SELECT * FROM ({sql}) AS result_row LIMIT {}",
            max_rows.saturating_add(1)
        );
        let mut statement = connection.prepare(&wrapped)?;
        let mut query = statement.query([])?;
        let columns = query
            .as_ref()
            .expect("query rows retain their statement")
            .column_names();
        let mut rows = Vec::new();
        while let Some(row) = query.next()? {
            let mut object = serde_json::Map::with_capacity(columns.len());
            for (index, name) in columns.iter().enumerate() {
                object.insert(name.clone(), value_json(row.get_ref(index)?));
            }
            rows.push(serde_json::Value::Object(object));
        }
        let truncated = rows.len() > max_rows;
        rows.truncate(max_rows);
        Ok(SqlResult { rows, truncated })
    }

    pub(crate) fn next_row_id(connection: &Connection) -> Result<i64, RecordingError> {
        let maximum: Option<i64> =
            connection.query_row("SELECT max(row_id) FROM recording_batches", [], |row| {
                row.get(0)
            })?;
        Ok(maximum.unwrap_or(0).saturating_add(1))
    }

    pub(crate) fn insert_binding(
        connection: &Connection,
        session_id: &str,
        binding: &DisplayBinding,
    ) -> Result<(), RecordingError> {
        insert_binding(connection, session_id, binding)
    }

    pub(crate) fn close_binding(
        connection: &Connection,
        session_id: &str,
        binding_id: &str,
    ) -> Result<(), RecordingError> {
        connection.execute(
            "UPDATE display_bindings SET unbound_at_us=? WHERE session_id=? AND id=?",
            params![now_us(), session_id, binding_id],
        )?;
        Ok(())
    }

    pub(crate) fn write_batch(
        connection: &Connection,
        session_id: &str,
        row_id: i64,
        batch: &RecordBatch,
    ) -> Result<usize, RecordingError> {
        validate_batch(batch)?;
        let payload = codec::encode(&batch.payload)?;
        let checksum = codec::checksum(&payload);
        let first_timestamp = batch.timestamps_us.first().copied().unwrap_or_default();
        let last_timestamp = batch
            .timestamps_us
            .last()
            .copied()
            .unwrap_or(first_timestamp);
        let effective_bytes = batch.payload.effective_bytes();
        connection.execute(
            "INSERT INTO recording_batches( \
                row_id, session_id, binding_id, domain, epoch, sequence_start, sequence_end, \
                first_timestamp_us, last_timestamp_us, item_count, effective_bytes, checksum, payload, committed_at_us \
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                row_id,
                session_id,
                &batch.binding_id,
                batch.payload.domain().as_str(),
                batch.epoch,
                batch.sequence_start,
                batch.sequence_end(),
                first_timestamp,
                last_timestamp,
                batch.payload.item_count() as u64,
                effective_bytes as u64,
                checksum,
                payload,
                now_us(),
            ],
        )?;
        Ok(effective_bytes)
    }

    pub(crate) fn update_session(
        connection: &Connection,
        session_id: &str,
        state: SessionState,
    ) -> Result<(), RecordingError> {
        let ended = matches!(state, SessionState::Stopped | SessionState::Failed).then(now_us);
        connection.execute(
            "UPDATE recording_sessions SET state=?, ended_at_us=? WHERE id=?",
            params![state.as_str(), ended, session_id],
        )?;
        Ok(())
    }
}

fn initialize(connection: &Connection) -> Result<(), RecordingError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS recording_sessions( \
            id VARCHAR PRIMARY KEY, started_at_us UBIGINT NOT NULL, ended_at_us UBIGINT, state VARCHAR NOT NULL); \
         CREATE TABLE IF NOT EXISTS display_bindings( \
            id VARCHAR NOT NULL, session_id VARCHAR NOT NULL REFERENCES recording_sessions(id), \
            component_id VARCHAR NOT NULL, source_node_id VARCHAR NOT NULL, source_handle VARCHAR NOT NULL, \
            domain VARCHAR NOT NULL, capability VARCHAR NOT NULL, bound_at_us UBIGINT NOT NULL, unbound_at_us UBIGINT, \
            PRIMARY KEY(session_id, id)); \
         CREATE TABLE IF NOT EXISTS recording_batches( \
            row_id BIGINT PRIMARY KEY, session_id VARCHAR NOT NULL REFERENCES recording_sessions(id), \
            binding_id VARCHAR NOT NULL, domain VARCHAR NOT NULL, epoch UBIGINT NOT NULL, \
            sequence_start UBIGINT NOT NULL, sequence_end UBIGINT NOT NULL, \
            first_timestamp_us UBIGINT NOT NULL, last_timestamp_us UBIGINT NOT NULL, \
            item_count UBIGINT NOT NULL, effective_bytes UBIGINT NOT NULL, checksum UBIGINT NOT NULL, \
            payload BLOB NOT NULL, committed_at_us UBIGINT NOT NULL); \
         CREATE INDEX IF NOT EXISTS recording_time_idx ON recording_batches(session_id, binding_id, first_timestamp_us);",
    )?;
    Ok(())
}

fn insert_binding(
    connection: &Connection,
    session_id: &str,
    binding: &DisplayBinding,
) -> Result<(), RecordingError> {
    connection.execute(
        "INSERT INTO display_bindings( \
            id, session_id, component_id, source_node_id, source_handle, domain, capability, bound_at_us \
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(session_id, id) DO UPDATE SET \
            component_id=excluded.component_id, source_node_id=excluded.source_node_id, \
            source_handle=excluded.source_handle, domain=excluded.domain, \
            capability=excluded.capability, bound_at_us=excluded.bound_at_us, unbound_at_us=NULL",
        params![
            &binding.id,
            session_id,
            &binding.component_id,
            &binding.port.source_node_id,
            &binding.port.source_handle,
            binding.domain.as_str(),
            binding.capability.as_str(),
            now_us(),
        ],
    )?;
    Ok(())
}

fn validate_batch(batch: &RecordBatch) -> Result<(), RecordingError> {
    let count = batch.payload.item_count();
    if count == 0 {
        return Err(RecordingError::Invalid("empty recording batch".into()));
    }
    let valid_timestamps = match &batch.payload {
        BatchPayload::Bytes { .. } | BatchPayload::Spectrum { .. } => {
            batch.timestamps_us.len() == 1
        }
        BatchPayload::String { .. } | BatchPayload::Float { .. } => {
            batch.timestamps_us.len() == count
        }
    };
    if !valid_timestamps {
        return Err(RecordingError::Invalid(
            "timestamp and payload column lengths differ".into(),
        ));
    }
    Ok(())
}

pub fn parse_domain(value: &str) -> Domain {
    match value {
        "bytes" => Domain::Bytes,
        "string" => Domain::String,
        "spectrum" => Domain::Spectrum,
        _ => Domain::Float,
    }
}

pub fn parse_state(value: &str) -> SessionState {
    match value {
        "running" => SessionState::Running,
        "paused" => SessionState::Paused,
        "stopped" => SessionState::Stopped,
        _ => SessionState::Failed,
    }
}

fn now_us() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_micros()).unwrap_or(u64::MAX)
        })
}

pub fn to_duckdb_error(error: impl std::fmt::Display) -> duckdb::Error {
    duckdb::Error::InvalidParameterName(error.to_string())
}

fn value_json(value: ValueRef<'_>) -> serde_json::Value {
    match value {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Boolean(value) => value.into(),
        ValueRef::TinyInt(value) => value.into(),
        ValueRef::SmallInt(value) => value.into(),
        ValueRef::Int(value) => value.into(),
        ValueRef::BigInt(value) => value.into(),
        ValueRef::UTinyInt(value) => value.into(),
        ValueRef::USmallInt(value) => value.into(),
        ValueRef::UInt(value) => value.into(),
        ValueRef::UBigInt(value) => value.into(),
        ValueRef::Float(value) => serde_json::Number::from_f64(f64::from(value))
            .map_or(serde_json::Value::Null, serde_json::Value::Number),
        ValueRef::Double(value) => serde_json::Number::from_f64(value)
            .map_or(serde_json::Value::Null, serde_json::Value::Number),
        ValueRef::Text(value) => String::from_utf8_lossy(value).into_owned().into(),
        ValueRef::Blob(value) | ValueRef::Geometry(value) => {
            format!("<binary:{} bytes>", value.len()).into()
        }
        ValueRef::HugeInt(value) => value.to_string().into(),
        ValueRef::UHugeInt(value) => value.to_string().into(),
        other => format!("{other:?}").into(),
    }
}
