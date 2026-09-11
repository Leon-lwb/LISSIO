use duckdb::{Connection, params_from_iter};

use crate::{RecordingCleanupResult, RecordingError};

pub fn delete_sessions_on(
    connection: &Connection,
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

    let markers = (0..unique.len()).map(|_| "?").collect::<Vec<_>>().join(",");
    let state_sql = format!("SELECT id, state FROM recording_sessions WHERE id IN ({markers})");
    let states = {
        let mut statement = connection.prepare(&state_sql)?;
        let rows = statement.query_map(params_from_iter(unique.iter().copied()), |row| {
            let id: String = row.get(0)?;
            let state: String = row.get(1)?;
            Ok((id, state))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    if states.len() != unique.len() {
        return Err(RecordingError::Invalid(
            "recording session was not found".into(),
        ));
    }
    for (_, state) in &states {
        if state == "running" || state == "paused" {
            return Err(RecordingError::Invalid(
                "an active recording session cannot be deleted".into(),
            ));
        }
    }

    let count_sql = format!(
        "SELECT count(*), coalesce(sum(item_count), 0), coalesce(sum(effective_bytes), 0) \
         FROM recording_batches WHERE session_id IN ({markers})",
    );
    let (deleted_batches, deleted_items, deleted_bytes): (u64, u64, u64) = connection.query_row(
        &count_sql,
        params_from_iter(unique.iter().copied()),
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;

    // DuckDB foreign-key checks do not observe child deletes that are still
    // inside the same transaction. Keep child deletes auto-committed before the
    // parent delete; per-session deletion minimizes partial-cleanup footprint.
    for id in &unique {
        connection.execute(
            "DELETE FROM recording_batches WHERE session_id = ?",
            params_from_iter(std::iter::once(*id)),
        )?;
        connection.execute(
            "DELETE FROM display_bindings WHERE session_id = ?",
            params_from_iter(std::iter::once(*id)),
        )?;
        connection.execute(
            "DELETE FROM recording_sessions WHERE id = ?",
            params_from_iter(std::iter::once(*id)),
        )?;
    }

    Ok(RecordingCleanupResult {
        deleted_sessions: u64::try_from(unique.len()).unwrap_or(u64::MAX),
        deleted_batches,
        deleted_items,
        deleted_bytes,
    })
}
