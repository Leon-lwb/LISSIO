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

    if deleted_batches > 0 {
        rebuild_batches_without_sessions(connection, &unique)?;
    }

    for id in &unique {
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

fn rebuild_batches_without_sessions(
    connection: &Connection,
    ids: &[&str],
) -> Result<(), RecordingError> {
    let markers = (0..ids.len()).map(|_| "?").collect::<Vec<_>>().join(",");
    connection.execute_batch(
        "DROP TABLE IF EXISTS recording_batches_old; \
         DROP TABLE IF EXISTS cleanup_sessions;",
    )?;
    let create_cleanup = format!(
        "CREATE TEMP TABLE cleanup_sessions AS \
         SELECT id FROM recording_sessions WHERE id IN ({markers})",
    );
    connection.execute(&create_cleanup, params_from_iter(ids.iter().copied()))?;
    connection.execute_batch("DROP INDEX IF EXISTS recording_time_idx;")?;
    connection.execute_batch("ALTER TABLE recording_batches RENAME TO recording_batches_old;")?;
    connection.execute_batch(
        "CREATE TABLE recording_batches( \
            row_id BIGINT PRIMARY KEY, session_id VARCHAR NOT NULL REFERENCES recording_sessions(id), \
            binding_id VARCHAR NOT NULL, domain VARCHAR NOT NULL, epoch UBIGINT NOT NULL, \
            sequence_start UBIGINT NOT NULL, sequence_end UBIGINT NOT NULL, \
            first_timestamp_us UBIGINT NOT NULL, last_timestamp_us UBIGINT NOT NULL, \
            item_count UBIGINT NOT NULL, effective_bytes UBIGINT NOT NULL, checksum UBIGINT NOT NULL, \
            payload BLOB NOT NULL, committed_at_us UBIGINT NOT NULL);",
    )?;
    connection.execute_batch(
        "INSERT INTO recording_batches \
         SELECT * FROM recording_batches_old \
         WHERE session_id NOT IN (SELECT id FROM cleanup_sessions);",
    )?;
    connection.execute_batch("DROP TABLE recording_batches_old;")?;
    connection.execute_batch("DROP TABLE cleanup_sessions;")?;
    connection.execute_batch(
        "CREATE INDEX IF NOT EXISTS recording_time_idx \
         ON recording_batches(session_id, binding_id, first_timestamp_us);",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use duckdb::Connection;

    #[test]
    fn rebuild_removes_selected_session_batches() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE recording_sessions(id VARCHAR PRIMARY KEY); \
                 INSERT INTO recording_sessions VALUES ('keep'), ('drop'); \
                 CREATE TABLE recording_batches( \
                    row_id BIGINT PRIMARY KEY, \
                    session_id VARCHAR NOT NULL REFERENCES recording_sessions(id), \
                    binding_id VARCHAR NOT NULL, domain VARCHAR NOT NULL, epoch UBIGINT NOT NULL, \
                    sequence_start UBIGINT NOT NULL, sequence_end UBIGINT NOT NULL, \
                    first_timestamp_us UBIGINT NOT NULL, last_timestamp_us UBIGINT NOT NULL, \
                    item_count UBIGINT NOT NULL, effective_bytes UBIGINT NOT NULL, \
                    checksum UBIGINT NOT NULL, payload BLOB NOT NULL, committed_at_us UBIGINT NOT NULL); \
                 INSERT INTO recording_batches VALUES \
                    (1, 'keep', 'binding', 'bytes', 1, 0, 0, 1, 1, 1, 1, 1, CAST('x' AS BLOB), 1), \
                    (2, 'drop', 'binding', 'bytes', 1, 0, 0, 1, 1, 1, 1, 1, CAST('x' AS BLOB), 1);",
            )
            .unwrap();
        rebuild_batches_without_sessions(&connection, &["drop"]).unwrap();
        let rows: i64 = connection
            .query_row("SELECT count(*) FROM recording_batches", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(rows, 1);
        let session: String = connection
            .query_row("SELECT session_id FROM recording_batches", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(session, "keep");
    }
}
