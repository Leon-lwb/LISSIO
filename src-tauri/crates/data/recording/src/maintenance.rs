use duckdb::{Connection, params, params_from_iter};

use crate::{RecordingCleanupResult, RecordingError};

/// Time index over recorded batches; dropped only when row deletion trips on it.
const TIME_INDEX: &str = "recording_time_idx";

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

    let known = known_terminal_sessions(connection, &unique)?;
    // Sessions that are already gone count as deleted: cleanup stays idempotent,
    // which is what the retry after a database repair relies on.
    let mut deleted_sessions = u64::try_from(unique.len() - known.len()).unwrap_or(u64::MAX);
    let mut deleted_batches = 0_u64;
    let mut deleted_items = 0_u64;
    let mut deleted_bytes = 0_u64;
    let mut skipped: Vec<&str> = Vec::new();
    let mut index_dropped = false;

    for id in known {
        let counts = batch_totals(connection, id)?;
        match delete_batches(connection, id, &mut index_dropped) {
            Ok(()) => {
                deleted_batches = deleted_batches.saturating_add(counts.0);
                deleted_items = deleted_items.saturating_add(counts.1);
                deleted_bytes = deleted_bytes.saturating_add(counts.2);
            }
            Err(error) if is_repairable(&error) => return Err(error),
            Err(_) => {
                skipped.push(id);
                continue;
            }
        }
        let removed = connection
            .execute(
                "DELETE FROM display_bindings WHERE session_id = ?",
                params![id],
            )
            .and_then(|_| {
                connection.execute("DELETE FROM recording_sessions WHERE id = ?", params![id])
            })
            .map_err(RecordingError::from);
        match removed {
            Ok(_) => deleted_sessions = deleted_sessions.saturating_add(1),
            Err(error) if is_repairable(&error) => return Err(error),
            Err(_) => skipped.push(id),
        }
    }

    if index_dropped {
        // The index is only an optimization; a failure here must not undo a cleanup.
        let _ = connection.execute_batch(&format!(
            "CREATE INDEX IF NOT EXISTS {TIME_INDEX} \
             ON recording_batches(session_id, binding_id, first_timestamp_us);"
        ));
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
                skipped.join(", ")
            )
        }),
    })
}

/// Ids that still exist, rejecting the sessions that a delete must never touch.
fn known_terminal_sessions<'a>(
    connection: &Connection,
    ids: &[&'a str],
) -> Result<Vec<&'a str>, RecordingError> {
    let markers = (0..ids.len()).map(|_| "?").collect::<Vec<_>>().join(",");
    let state_sql = format!("SELECT id, state FROM recording_sessions WHERE id IN ({markers})");
    let states = {
        let mut statement = connection.prepare(&state_sql)?;
        let rows = statement.query_map(params_from_iter(ids.iter().copied()), |row| {
            let id: String = row.get(0)?;
            let state: String = row.get(1)?;
            Ok((id, state))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    for (_, state) in &states {
        if state == "running" || state == "paused" {
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

fn delete_batches(
    connection: &Connection,
    id: &str,
    index_dropped: &mut bool,
) -> Result<(), RecordingError> {
    let sql = "DELETE FROM recording_batches WHERE session_id = ?";
    match connection.execute(sql, params![id]) {
        Ok(_) => Ok(()),
        Err(error) if *index_dropped => Err(error.into()),
        Err(_) => {
            // DuckDB can fail row-wise index deletion on large sessions; retry
            // without the time index instead of rebuilding the whole table.
            connection.execute_batch(&format!("DROP INDEX IF EXISTS {TIME_INDEX};"))?;
            *index_dropped = true;
            connection.execute(sql, params![id])?;
            Ok(())
        }
    }
}
fn batch_totals(connection: &Connection, id: &str) -> Result<(u64, u64, u64), RecordingError> {
    connection
        .query_row(
            "SELECT count(*), coalesce(sum(item_count), 0), coalesce(sum(effective_bytes), 0) \
             FROM recording_batches WHERE session_id = ?",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(Into::into)
}

/// Only a damaged catalog justifies rebuilding the database file; anything else
/// is reported as a skipped session so cleanup never blocks the panel.
fn is_repairable(error: &RecordingError) -> bool {
    crate::repair::is_catalog_damage(error)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: &str = "CREATE TABLE recording_sessions( \
            id VARCHAR PRIMARY KEY, started_at_us UBIGINT NOT NULL, ended_at_us UBIGINT, \
            state VARCHAR NOT NULL); \
         CREATE TABLE display_bindings( \
            id VARCHAR NOT NULL, session_id VARCHAR NOT NULL REFERENCES recording_sessions(id), \
            component_id VARCHAR NOT NULL, source_node_id VARCHAR NOT NULL, source_handle VARCHAR NOT NULL, \
            domain VARCHAR NOT NULL, capability VARCHAR NOT NULL, bound_at_us UBIGINT NOT NULL, \
            unbound_at_us UBIGINT, PRIMARY KEY(session_id, id)); \
         CREATE TABLE recording_batches( \
            row_id BIGINT PRIMARY KEY, session_id VARCHAR NOT NULL REFERENCES recording_sessions(id), \
            binding_id VARCHAR NOT NULL, domain VARCHAR NOT NULL, epoch UBIGINT NOT NULL, \
            sequence_start UBIGINT NOT NULL, sequence_end UBIGINT NOT NULL, \
            first_timestamp_us UBIGINT NOT NULL, last_timestamp_us UBIGINT NOT NULL, \
            item_count UBIGINT NOT NULL, effective_bytes UBIGINT NOT NULL, checksum UBIGINT NOT NULL, \
            payload BLOB NOT NULL, committed_at_us UBIGINT NOT NULL); \
         CREATE INDEX IF NOT EXISTS recording_time_idx \
            ON recording_batches(session_id, binding_id, first_timestamp_us);";

    fn seeded() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        connection
            .execute_batch(
                "INSERT INTO recording_sessions VALUES ('keep', 1, 2, 'stopped'), ('drop', 3, 4, 'failed'); \
                 INSERT INTO display_bindings VALUES ('b1', 'drop', 'c', 's', 'h', 'bytes', 'records', 1, NULL); \
                 INSERT INTO recording_batches \
                    SELECT range, 'drop', 'b1', 'bytes', 1, range, range, range, range, 1, 8, 0, \
                           repeat('x', 8)::BLOB, range \
                    FROM range(50);",
            )
            .unwrap();
        connection
    }

    #[test]
    fn deletes_children_before_the_session_row() {
        let connection = seeded();
        let result = delete_sessions_on(&connection, "current", &["drop".to_string()]).unwrap();
        assert_eq!(result.deleted_sessions, 1);
        assert_eq!(result.deleted_batches, 50);
        assert_eq!(result.deleted_items, 50);
        assert_eq!(result.deleted_bytes, 400);
        assert!(result.warning.is_none());
        let sessions: i64 = connection
            .query_row("SELECT count(*) FROM recording_sessions", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(sessions, 1);
    }

    #[test]
    fn deleting_a_missing_session_is_idempotent() {
        let connection = seeded();
        delete_sessions_on(&connection, "current", &["drop".to_string()]).unwrap();
        let repeat = delete_sessions_on(&connection, "current", &["drop".to_string()]).unwrap();
        assert_eq!(repeat.deleted_sessions, 1);
        assert_eq!(repeat.deleted_batches, 0);
        assert!(repeat.warning.is_none());
    }

    #[test]
    fn rejects_the_current_and_active_sessions() {
        let connection = seeded();
        let current = delete_sessions_on(&connection, "drop", &["drop".to_string()]);
        assert!(current.is_err());
        connection
            .execute_batch("INSERT INTO recording_sessions VALUES ('live', 5, NULL, 'running');")
            .unwrap();
        let active = delete_sessions_on(&connection, "current", &["live".to_string()]);
        assert!(active.is_err());
        let sessions: i64 = connection
            .query_row("SELECT count(*) FROM recording_sessions", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(sessions, 3);
    }
}
