//! SeaORM cleanup — the session delete paths.
//!
//! Reproduces the policy [`crate::maintenance::delete_sessions_on`] applies for
//! DuckDB: the current session may not be deleted, an active one is refused,
//! sessions that are already gone still count as deleted so cleanup stays
//! idempotent, and a session that cannot be removed is reported as a warning
//! instead of failing the whole batch. Only the failure classification differs:
//! DuckDB escalates its catalog/index damage to a rebuild by returning `Err`,
//! while SQLite has no such error class (see
//! [`SeaOrmEngine::is_recoverable`](super::sea::SeaOrmEngine)), so every delete
//! failure becomes a skipped session here.
//!
//! The DuckDB path drops the time index before deleting batches because a stale
//! index poisons the whole instance; SQLite maintains index entries per row
//! inside the same statement, so no index dance is needed.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, QueryResult, Statement, Value};

use super::sea_sql::{database_error, get_string, map_error, parse_state, statement};
use crate::{RecordingCleanupResult, RecordingError, SessionState};

/// Delete one session and its children. Mirrors the DuckDB single-session path:
/// a missing session is an error, and a running or paused one must never be
/// removed while a recorder may still be writing into it.
pub async fn delete_session(
    connection: &DatabaseConnection,
    session_id: &str,
) -> Result<(), RecordingError> {
    let row = connection
        .query_one_raw(statement(
            "SELECT state FROM recording_sessions WHERE id=?",
            [Value::from(session_id)],
        ))
        .await
        .map_err(database_error)?;
    let Some(row) = row else {
        return Err(RecordingError::Invalid(
            "recording session was not found".into(),
        ));
    };
    let state = get_string(&row, 0)?;
    if matches!(
        parse_state(&state),
        SessionState::Running | SessionState::Paused
    ) {
        return Err(RecordingError::Invalid(
            "an active recording session cannot be deleted".into(),
        ));
    }
    delete_batches(connection, session_id).await?;
    delete_session_rows(connection, session_id).await
}

pub async fn delete_sessions(
    connection: &DatabaseConnection,
    current_session_id: &str,
    session_ids: &[String],
) -> Result<RecordingCleanupResult, RecordingError> {
    let mut unique: Vec<&str> = Vec::new();
    for id in session_ids {
        if id == current_session_id {
            return Err(RecordingError::Invalid(
                "the current recording session cannot be deleted".into(),
            ));
        }
        if !unique.contains(&id.as_str()) {
            unique.push(id.as_str());
        }
    }
    if unique.is_empty() {
        return Ok(RecordingCleanupResult::default());
    }

    let known = known_terminal_sessions(connection, &unique).await?;
    // Sessions that are already gone count as deleted: cleanup stays idempotent,
    // which is what the retry after a database repair relies on.
    let mut deleted_sessions = u64::try_from(unique.len() - known.len()).unwrap_or(u64::MAX);
    let mut deleted_batches = 0_u64;
    let mut deleted_items = 0_u64;
    let mut deleted_bytes = 0_u64;
    let mut skipped: Vec<(&str, String)> = Vec::new();

    for id in known {
        let counts = batch_totals(connection, id).await?;
        match delete_batches(connection, id).await {
            Ok(()) => {
                deleted_batches = deleted_batches.saturating_add(counts.0);
                deleted_items = deleted_items.saturating_add(counts.1);
                deleted_bytes = deleted_bytes.saturating_add(counts.2);
            }
            Err(error) => {
                skipped.push((id, first_line(&error)));
                continue;
            }
        }
        match delete_session_rows(connection, id).await {
            Ok(()) => deleted_sessions = deleted_sessions.saturating_add(1),
            Err(error) => skipped.push((id, first_line(&error))),
        }
    }

    Ok(RecordingCleanupResult {
        deleted_sessions,
        deleted_batches,
        deleted_items,
        deleted_bytes,
        warning: (!skipped.is_empty()).then(|| {
            format!(
                "{} recording session(s) could not be deleted: {}",
                skipped.len(),
                skipped
                    .iter()
                    .map(|(id, reason)| format!("{id} ({reason})"))
                    .collect::<Vec<_>>()
                    .join("; ")
            )
        }),
    })
}

/// Ids that still exist, rejecting the sessions that a delete must never touch.
async fn known_terminal_sessions<'a>(
    connection: &DatabaseConnection,
    ids: &[&'a str],
) -> Result<Vec<&'a str>, RecordingError> {
    let markers = (0..ids.len()).map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("SELECT id, state FROM recording_sessions WHERE id IN ({markers})");
    let rows = connection
        .query_all_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            sql,
            ids.iter().map(|id| Value::from(*id)),
        ))
        .await
        .map_err(database_error)?;
    let states = rows
        .iter()
        .map(|row| Ok((get_string(row, 0)?, get_string(row, 1)?)))
        .collect::<Result<Vec<_>, RecordingError>>()?;
    for (_, state) in &states {
        if matches!(
            parse_state(state),
            SessionState::Running | SessionState::Paused
        ) {
            return Err(RecordingError::Invalid(
                "an active recording session cannot be deleted".into(),
            ));
        }
    }
    Ok(ids
        .iter()
        .filter(|id| states.iter().any(|(known, _)| known == *id))
        .copied()
        .collect())
}

async fn batch_totals(
    connection: &DatabaseConnection,
    id: &str,
) -> Result<(u64, u64, u64), RecordingError> {
    let row = connection
        .query_one_raw(statement(
            "SELECT count(*), coalesce(sum(item_count), 0), coalesce(sum(effective_bytes), 0) \
             FROM recording_batches WHERE session_id = ?",
            [Value::from(id)],
        ))
        .await
        .map_err(database_error)?
        .ok_or_else(|| RecordingError::Failed("batch totals returned no row".into()))?;
    Ok((counts(&row, 0)?, counts(&row, 1)?, counts(&row, 2)?))
}

fn counts(row: &QueryResult, index: usize) -> Result<u64, RecordingError> {
    // `count` and `sum` are non-negative by construction; a negative value would
    // mean a stored counter wrapped, so report that rather than reinterpreting
    // the bits the way the raw `u64` columns do.
    u64::try_from(map_error(row.try_get_by_index::<i64>(index))?)
        .map_err(|error| RecordingError::Corrupt(format!("negative recording counter: {error}")))
}

async fn delete_batches(
    connection: &DatabaseConnection,
    session_id: &str,
) -> Result<(), RecordingError> {
    connection
        .execute_raw(statement(
            "DELETE FROM recording_batches WHERE session_id = ?",
            [Value::from(session_id)],
        ))
        .await
        .map_err(database_error)?;
    Ok(())
}

/// Children first, then the session row.
async fn delete_session_rows(
    connection: &DatabaseConnection,
    session_id: &str,
) -> Result<(), RecordingError> {
    connection
        .execute_raw(statement(
            "DELETE FROM display_bindings WHERE session_id = ?",
            [Value::from(session_id)],
        ))
        .await
        .map_err(database_error)?;
    connection
        .execute_raw(statement(
            "DELETE FROM recording_sessions WHERE id = ?",
            [Value::from(session_id)],
        ))
        .await
        .map_err(database_error)?;
    Ok(())
}

/// The user-visible reason keeps only its first line.
fn first_line(error: &RecordingError) -> String {
    error
        .to_string()
        .lines()
        .next()
        .unwrap_or_default()
        .to_string()
}
