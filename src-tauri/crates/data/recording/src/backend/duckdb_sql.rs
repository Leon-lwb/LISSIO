//! DuckDB statements — every engine-specific statement lives here.
//!
//! The store contract in [`crate::port`] never sees a `Connection`; this module
//! and its parent are the only places that do.

use data_model::now_us;
use std::path::Path;

use duckdb::{AccessMode, Config, Connection, params};

use super::duckdb_read_sql::{list_sessions, session_is_empty};
use crate::codec;
use crate::{
    DisplayBinding, RecordBatch, RecordingCleanupResult, RecordingError, SessionInfo, SessionState,
};

/// Write-session parameters.
///
/// `checkpoint_threshold` decides when an automatic checkpoint triggers — the
/// writer thread stalls during one, and a stall longer than the queue buffer is
/// one backpressure event. Raising the threshold from 256 MiB to 1 GiB trades
/// longer single stalls for fewer of them, which the 4096-entry writer queue
/// absorbs.
const WRITE_SESSION_PRAGMAS: &str =
    "SET preserve_insertion_order=false; SET threads=4; SET checkpoint_threshold='1 GiB';";

/// Open a read/write connection with the write-session parameters applied.
pub(super) fn connect(path: &Path) -> Result<Connection, RecordingError> {
    let connection = Connection::open(path)?;
    connection.execute_batch(WRITE_SESSION_PRAGMAS)?;
    Ok(connection)
}

/// Open a read-only connection with external access disabled.
pub(super) fn connect_read_only(path: &Path) -> Result<Connection, RecordingError> {
    let config = Config::default()
        .access_mode(AccessMode::ReadOnly)?
        .enable_external_access(false)?;
    let connection = Connection::open_with_flags(path, config)?;
    connection.execute_batch("SET threads=4;")?;
    Ok(connection)
}

/// Open, create the schema, and verify the catalog.
///
/// Opening verifies by actually reading the three tables: a damaged catalog
/// makes `CREATE TABLE IF NOT EXISTS` succeed while any read fails, so the
/// check must read. Damage is classified and repaired here, and the returned
/// note is what the caller surfaces as a warning — a rebuilt database means
/// recording recovered, never a failure.
pub(super) fn open_checked(path: &Path) -> Result<(Connection, Option<String>), RecordingError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // File-level damage: opening fails with nothing readable to export, so the
    // original is quarantined and recording continues in a new empty database.
    let connection = match connect(path) {
        Ok(connection) => connection,
        Err(error) if crate::repair::is_unreadable(&error) => {
            let backup = crate::repair::quarantine_database(path)?;
            let connection = connect(path)?;
            crate::schema::initialize(&connection)?;
            mark_orphaned_sessions(&connection)?;
            return Ok((connection, Some(quarantined_note(&backup))));
        }
        Err(error) => return Err(error),
    };
    crate::schema::initialize(&connection)?;
    match crate::repair::verify_catalog(&connection) {
        Ok(()) => {
            mark_orphaned_sessions(&connection)?;
            Ok((connection, None))
        }
        // Catalog damage: rebuilding needs every connection closed first.
        Err(error) if crate::repair::is_catalog_damage(&error) => {
            drop(connection);
            let backup = crate::repair::rebuild_database(path)?;
            let connection = connect(path)?;
            crate::schema::initialize(&connection)?;
            mark_orphaned_sessions(&connection)?;
            Ok((connection, Some(rebuilt_note(&backup))))
        }
        Err(error) => Err(error),
    }
}

/// A process crash cannot have committed data after the final transaction. Mark
/// orphaned sessions explicitly while retaining their last valid commit.
pub(super) fn mark_orphaned_sessions(connection: &Connection) -> Result<(), RecordingError> {
    connection.execute(
        "UPDATE recording_sessions SET state='failed', ended_at_us=? \
         WHERE state IN ('running', 'paused')",
        params![now_us()],
    )?;
    Ok(())
}

pub(super) fn next_row_id(connection: &Connection) -> Result<i64, RecordingError> {
    let maximum: Option<i64> =
        connection.query_row("SELECT max(row_id) FROM recording_batches", [], |row| {
            row.get(0)
        })?;
    Ok(maximum.unwrap_or(0).saturating_add(1))
}

pub(super) fn create_session(
    connection: &Connection,
    bindings: &[DisplayBinding],
) -> Result<SessionInfo, RecordingError> {
    let started_at_us = now_us();
    let id = format!("{started_at_us}-{}", std::process::id());
    connection.execute_batch("BEGIN TRANSACTION")?;
    let result = (|| {
        connection.execute(
            "INSERT INTO recording_sessions(id, started_at_us, state) VALUES (?, ?, 'running')",
            params![&id, started_at_us],
        )?;
        for binding in bindings {
            insert_binding(connection, &id, binding)?;
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

/// Resume a finished session for further writes: clears the end timestamp and
/// stores `state`. Only explicitly stopped sessions can be resumed.
pub(super) fn reopen_session(
    connection: &Connection,
    session_id: &str,
    state: SessionState,
) -> Result<SessionInfo, RecordingError> {
    let updated = connection.execute(
        "UPDATE recording_sessions SET state=?, ended_at_us=NULL \
         WHERE id=? AND state='stopped'",
        params![state.as_str(), session_id],
    )?;
    if updated == 0 {
        return Err(RecordingError::Invalid(format!(
            "recording session was not found or is not resumable: {session_id}"
        )));
    }
    list_sessions(connection)?
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
/// The empty session is normalized to `stopped` first so `reopen_session`
/// accepts it.
pub(super) fn resumable_empty_session(
    connection: &Connection,
) -> Result<Option<String>, RecordingError> {
    let latest = match connection.query_row(
        "SELECT id, state FROM recording_sessions ORDER BY started_at_us DESC LIMIT 1",
        [],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    ) {
        Ok(row) => Some(row),
        Err(duckdb::Error::QueryReturnedNoRows) => None,
        Err(error) => return Err(error.into()),
    };
    let Some((id, state)) = latest else {
        return Ok(None);
    };
    if !session_is_empty(connection, &id)? {
        return Ok(None);
    }
    if parse_state(&state) != SessionState::Stopped {
        connection.execute(
            "UPDATE recording_sessions SET state='stopped', ended_at_us=? WHERE id=?",
            params![now_us(), &id],
        )?;
    }
    Ok(Some(id))
}

pub(super) fn write_batch(
    connection: &Connection,
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

pub(super) fn insert_binding(
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

pub(super) fn close_binding(
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

pub(super) fn update_session(
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

pub(super) fn delete_session(
    connection: &Connection,
    session_id: &str,
) -> Result<(), RecordingError> {
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
    // Same reason as `maintenance::delete_sessions`: deleting indexed batches
    // escalates an index/table mismatch into a fatal instance failure, so the
    // time index comes off first and is rebuilt from the remaining rows after.
    crate::maintenance::drop_time_index(connection)?;
    let result = (|| -> Result<(), RecordingError> {
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
    })();
    let _ = crate::maintenance::create_time_index(connection);
    result
}

pub(super) fn delete_sessions(
    connection: &Connection,
    current_session_id: &str,
    session_ids: &[String],
) -> Result<RecordingCleanupResult, RecordingError> {
    crate::maintenance::delete_sessions_on(connection, current_session_id, session_ids)
}

/// Automatic-rebuild notice — carried on the health report's warning channel,
/// **never** as `failed`: a successful rebuild means recording recovered, and
/// reporting it as a failure would stop acquisition.
pub(super) fn rebuilt_note(backup: &Path) -> String {
    format!(
        "the recording database catalog was damaged and was rebuilt automatically \
         (the damaged copy is kept at {})",
        backup.display()
    )
}

/// Quarantine notice for file-level damage — same warning channel.
pub(super) fn quarantined_note(backup: &Path) -> String {
    format!(
        "the recording database file could not be read and was moved aside \
         (the unreadable copy is kept at {}); recording continues in a new empty database",
        backup.display()
    )
}

pub(super) fn parse_domain(value: &str) -> crate::Domain {
    match value {
        "bytes" => crate::Domain::Bytes,
        "string" => crate::Domain::String,
        "spectrum" => crate::Domain::Spectrum,
        _ => crate::Domain::Float,
    }
}

pub(super) fn parse_state(value: &str) -> SessionState {
    match value {
        "running" => SessionState::Running,
        "paused" => SessionState::Paused,
        "stopped" => SessionState::Stopped,
        _ => SessionState::Failed,
    }
}

/// Milliseconds-free monotonic wall clock in microseconds since the Unix epoch.
/// Codec failures have no DuckDB error variant of their own; the port reports
/// them through the database error so the message survives unchanged.
pub(super) fn to_duckdb_error(error: impl std::fmt::Display) -> duckdb::Error {
    duckdb::Error::InvalidParameterName(error.to_string())
}
