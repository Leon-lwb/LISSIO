//! SeaORM statements — the write SQL plus the value codecs and row helpers that
//! [`super::sea_read_sql`] shares.
//!
//! The SQL is the same portable text the DuckDB engine uses (see
//! [`super::duckdb_sql`]); only parameter binding and row decoding differ,
//! because SeaORM hands rows back as [`QueryResult`] instead of DuckDB row
//! references.
//!
//! SQLite has no unsigned integer type: an `INTEGER` column is a signed 64-bit
//! value. Every `u64` therefore crosses the boundary as a bit-pattern
//! reinterpretation ([`u64_value`] / [`get_u64`]) rather than a numeric cast —
//! a checksum is an arbitrary 64-bit value and `i64::try_from` would panic on
//! half of all batches.

use data_model::now_us;
use sea_orm::{
    ConnectionTrait, DatabaseConnection, DbBackend, DbErr, QueryResult, Statement, Value,
};

use crate::codec;
use crate::{
    BindingCapability, DisplayBinding, RecordBatch, RecordingError, SessionInfo, SessionState,
};

/// SeaORM reports every engine failure as [`DbErr`]; [`RecordingError`] only
/// carries a DuckDB variant. `Failed` lands in the same failure class as
/// `Database` (see `hub::fault`), so the real message survives without
/// fabricating a DuckDB error value.
pub fn database_error(error: DbErr) -> RecordingError {
    RecordingError::Failed(format!("sqlite error: {error}"))
}

/// `Result<T, DbErr>` in the store's error type.
pub fn map_error<T>(result: Result<T, DbErr>) -> Result<T, RecordingError> {
    result.map_err(database_error)
}

/// Bind a `u64` as a SQLite `INTEGER` without changing the upper half of the
/// range; [`get_u64`] reverses it.
pub const fn u64_value(value: u64) -> Value {
    Value::BigInt(Some(value.cast_signed()))
}

/// [`u64_value`] for a nullable column.
pub fn optional_u64_value(value: Option<u64>) -> Value {
    Value::BigInt(value.map(u64::cast_signed))
}

/// Bind a nullable string parameter — SQLite needs a typed NULL, not an absent
/// parameter, because the read SQL tests it with `? IS NULL`.
pub fn optional_text_value(value: Option<&str>) -> Value {
    Value::String(value.map(ToString::to_string))
}

pub fn get_i64(row: &QueryResult, index: usize) -> Result<i64, RecordingError> {
    map_error(row.try_get_by_index::<i64>(index))
}

pub fn get_u64(row: &QueryResult, index: usize) -> Result<u64, RecordingError> {
    Ok(get_i64(row, index)?.cast_unsigned())
}

pub fn get_optional_u64(row: &QueryResult, index: usize) -> Result<Option<u64>, RecordingError> {
    map_error(row.try_get_by_index::<Option<i64>>(index)).map(|value| value.map(i64::cast_unsigned))
}

pub fn get_string(row: &QueryResult, index: usize) -> Result<String, RecordingError> {
    map_error(row.try_get_by_index::<String>(index))
}

/// Milliseconds-free monotonic wall clock in microseconds since the Unix epoch.
pub fn parse_domain(value: &str) -> crate::Domain {
    match value {
        "bytes" => crate::Domain::Bytes,
        "string" => crate::Domain::String,
        "spectrum" => crate::Domain::Spectrum,
        _ => crate::Domain::Float,
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

pub fn parse_capability(value: &str) -> BindingCapability {
    match value {
        "scalar" => BindingCapability::Scalar,
        "text" => BindingCapability::Text,
        "records" => BindingCapability::Records,
        "curve" => BindingCapability::Curve,
        _ => BindingCapability::Raw,
    }
}

/// Statement with SQLite placeholders and `values`.
pub fn statement(sql: impl Into<String>, values: impl IntoIterator<Item = Value>) -> Statement {
    Statement::from_sql_and_values(DbBackend::Sqlite, sql, values)
}

/// Crash recovery parity with the DuckDB engine: a process that died mid-session
/// left `running`/`paused` rows behind, and the last committed transaction is
/// still the newest valid state, so the orphan is closed as `failed` while its
/// data is kept.
pub async fn mark_orphaned_sessions(connection: &DatabaseConnection) -> Result<(), RecordingError> {
    connection
        .execute_raw(statement(
            "UPDATE recording_sessions SET state='failed', ended_at_us=? \
             WHERE state IN ('running', 'paused')",
            [u64_value(now_us())],
        ))
        .await
        .map_err(database_error)?;
    Ok(())
}

pub async fn next_row_id(connection: &DatabaseConnection) -> Result<i64, RecordingError> {
    let row = connection
        .query_one_raw(statement("SELECT max(row_id) FROM recording_batches", []))
        .await
        .map_err(database_error)?
        .ok_or_else(|| RecordingError::Failed("max(row_id) returned no row".into()))?;
    let maximum = map_error(row.try_get_by_index::<Option<i64>>(0))?;
    Ok(maximum.unwrap_or(0).saturating_add(1))
}

pub async fn create_session(
    connection: &DatabaseConnection,
    bindings: &[DisplayBinding],
) -> Result<SessionInfo, RecordingError> {
    let started_at_us = now_us();
    let id = format!("{started_at_us}-{}", std::process::id());
    connection
        .execute_unprepared("BEGIN")
        .await
        .map_err(database_error)?;
    let result = insert_session(connection, &id, started_at_us, bindings).await;
    match result {
        Ok(()) => {
            connection
                .execute_unprepared("COMMIT")
                .await
                .map_err(database_error)?;
            Ok(SessionInfo {
                id,
                started_at_us,
                ended_at_us: None,
                state: SessionState::Running,
            })
        }
        Err(error) => {
            // The rollback is best effort: the original failure is the one the
            // caller must see.
            let _ = connection.execute_unprepared("ROLLBACK").await;
            Err(error)
        }
    }
}

async fn insert_session(
    connection: &DatabaseConnection,
    id: &str,
    started_at_us: u64,
    bindings: &[DisplayBinding],
) -> Result<(), RecordingError> {
    connection
        .execute_raw(statement(
            "INSERT INTO recording_sessions(id, started_at_us, state) VALUES (?, ?, 'running')",
            [Value::from(id), u64_value(started_at_us)],
        ))
        .await
        .map_err(database_error)?;
    for binding in bindings {
        insert_binding(connection, id, binding).await?;
    }
    Ok(())
}

/// Resume a finished session for further writes: clears the end timestamp and
/// stores `state`. Only explicitly stopped sessions can be resumed.
pub async fn reopen_session(
    connection: &DatabaseConnection,
    session_id: &str,
    state: SessionState,
) -> Result<SessionInfo, RecordingError> {
    let updated = connection
        .execute_raw(statement(
            "UPDATE recording_sessions SET state=?, ended_at_us=NULL \
             WHERE id=? AND state='stopped'",
            [Value::from(state.as_str()), Value::from(session_id)],
        ))
        .await
        .map_err(database_error)?;
    if updated.rows_affected() == 0 {
        return Err(RecordingError::Invalid(format!(
            "recording session was not found or is not resumable: {session_id}"
        )));
    }
    super::sea_read_sql::list_sessions(connection)
        .await?
        .into_iter()
        .find(|session| session.id == session_id)
        .ok_or_else(|| {
            RecordingError::Invalid(format!("recording session was not found: {session_id}"))
        })
}

/// Startup continuation probe: the newest session's id when it holds no batches.
///
/// An empty session carries no data to lose (including one left `failed` by
/// crash recovery), so resuming it keeps restarts from piling up empty sessions.
/// The empty session is normalized to `stopped` first so [`reopen_session`]
/// accepts it.
pub async fn resumable_empty_session(
    connection: &DatabaseConnection,
) -> Result<Option<String>, RecordingError> {
    let latest = connection
        .query_one_raw(statement(
            "SELECT id, state FROM recording_sessions ORDER BY started_at_us DESC LIMIT 1",
            [],
        ))
        .await
        .map_err(database_error)?;
    let Some(row) = latest else {
        return Ok(None);
    };
    let id = get_string(&row, 0)?;
    let state = get_string(&row, 1)?;
    if !super::sea_read_sql::session_is_empty(connection, &id).await? {
        return Ok(None);
    }
    if parse_state(&state) != SessionState::Stopped {
        connection
            .execute_raw(statement(
                "UPDATE recording_sessions SET state='stopped', ended_at_us=? WHERE id=?",
                [u64_value(now_us()), Value::from(&id)],
            ))
            .await
            .map_err(database_error)?;
    }
    Ok(Some(id))
}

pub async fn write_batch(
    connection: &DatabaseConnection,
    session_id: &str,
    row_id: i64,
    batch: &RecordBatch,
) -> Result<usize, RecordingError> {
    crate::model::validate_batch(batch)?;
    let payload = codec::encode(&batch.payload)?;
    let checksum = codec::checksum(&payload);
    let first_timestamp = batch.timestamps_us.first().copied().unwrap_or_default();
    let last_timestamp = batch
        .timestamps_us
        .last()
        .copied()
        .unwrap_or(first_timestamp);
    let effective_bytes = batch.payload.effective_bytes();
    connection
        .execute_raw(statement(
            "INSERT INTO recording_batches( \
                row_id, session_id, binding_id, domain, epoch, sequence_start, sequence_end, \
                first_timestamp_us, last_timestamp_us, item_count, effective_bytes, checksum, payload, committed_at_us \
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                Value::from(row_id),
                Value::from(session_id),
                Value::from(&batch.binding_id),
                Value::from(batch.payload.domain().as_str()),
                u64_value(batch.epoch),
                u64_value(batch.sequence_start),
                u64_value(batch.sequence_end()),
                u64_value(first_timestamp),
                u64_value(last_timestamp),
                u64_value(u64::try_from(batch.payload.item_count()).unwrap_or(u64::MAX)),
                u64_value(u64::try_from(effective_bytes).unwrap_or(u64::MAX)),
                u64_value(checksum),
                Value::Bytes(Some(payload)),
                u64_value(now_us()),
            ],
        ))
        .await
        .map_err(database_error)?;
    Ok(effective_bytes)
}

pub async fn insert_binding(
    connection: &DatabaseConnection,
    session_id: &str,
    binding: &DisplayBinding,
) -> Result<(), RecordingError> {
    connection
        .execute_raw(statement(
            "INSERT INTO display_bindings( \
                id, session_id, component_id, source_node_id, source_handle, domain, capability, bound_at_us \
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(session_id, id) DO UPDATE SET \
                component_id=excluded.component_id, source_node_id=excluded.source_node_id, \
                source_handle=excluded.source_handle, domain=excluded.domain, \
                capability=excluded.capability, bound_at_us=excluded.bound_at_us, unbound_at_us=NULL",
            [
                Value::from(&binding.id),
                Value::from(session_id),
                Value::from(&binding.component_id),
                Value::from(&binding.port.source_node_id),
                Value::from(&binding.port.source_handle),
                Value::from(binding.domain.as_str()),
                Value::from(binding.capability.as_str()),
                u64_value(now_us()),
            ],
        ))
        .await
        .map_err(database_error)?;
    Ok(())
}

pub async fn close_binding(
    connection: &DatabaseConnection,
    session_id: &str,
    binding_id: &str,
) -> Result<(), RecordingError> {
    connection
        .execute_raw(statement(
            "UPDATE display_bindings SET unbound_at_us=? WHERE session_id=? AND id=?",
            [
                u64_value(now_us()),
                Value::from(session_id),
                Value::from(binding_id),
            ],
        ))
        .await
        .map_err(database_error)?;
    Ok(())
}

pub async fn update_session(
    connection: &DatabaseConnection,
    session_id: &str,
    state: SessionState,
) -> Result<(), RecordingError> {
    let ended = matches!(state, SessionState::Stopped | SessionState::Failed).then(now_us);
    connection
        .execute_raw(statement(
            "UPDATE recording_sessions SET state=?, ended_at_us=? WHERE id=?",
            [
                Value::from(state.as_str()),
                optional_u64_value(ended),
                Value::from(session_id),
            ],
        ))
        .await
        .map_err(database_error)?;
    Ok(())
}
