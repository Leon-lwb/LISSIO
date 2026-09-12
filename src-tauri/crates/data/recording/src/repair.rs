//! Catalog damage detection and file-level repair.
//!
//! DuckDB can keep a foreign-key dependency on a table that no longer exists when
//! a schema change is interrupted. Every later `DELETE` on the referenced table
//! then fails with a catalog error that names the missing table, which made
//! history cleanup - and with it the recording panel - unusable.
//!
//! The stale entry cannot be removed with SQL, so recovery exports every table
//! into a fresh database file and swaps it in. The damaged file is kept next to
//! the database so nothing is destroyed before the replacement is verified.

use std::path::{Path, PathBuf};

use duckdb::Connection;

use crate::RecordingError;

const TABLES: [&str; 3] = [
    "recording_sessions",
    "display_bindings",
    "recording_batches",
];

/// Whether the error means the catalog points at a table that is gone.
pub fn is_catalog_damage(error: &RecordingError) -> bool {
    let message = error.to_string();
    message.contains("Catalog Error") && message.contains("does not exist")
}

/// Rebuild `path` into a clean database file and return the backup of the original.
///
/// The caller must have closed every connection to `path` first.
pub fn rebuild_database(path: &Path) -> Result<PathBuf, RecordingError> {
    if !path.try_exists()? {
        return Err(RecordingError::Corrupt(
            "recording database file is missing".into(),
        ));
    }
    let stamp = stamp();
    let export_dir = sibling(path, &format!(".repair-{stamp}.export"));
    let staged = sibling(path, &format!(".repair-{stamp}.duckdb"));
    let backup = path.with_file_name(format!(
        "{}.corrupt-{stamp}.duckdb",
        path.file_stem().map_or_else(
            || "recording".to_string(),
            |stem| stem.to_string_lossy().into_owned()
        )
    ));

    remove_directory(&export_dir);
    remove_file(&staged);
    remove_file(&wal_path(&staged));

    let before = export_tables(path, &export_dir)?;
    let after = match import_tables(&staged, &export_dir) {
        Ok(counts) => counts,
        Err(error) => {
            discard(&staged, &export_dir);
            return Err(error);
        }
    };
    if after != before {
        discard(&staged, &export_dir);
        return Err(RecordingError::Corrupt(
            "recording database repair changed the stored rows".into(),
        ));
    }

    swap_in(path, &staged, &backup)?;
    remove_file(&wal_path(&staged));
    remove_directory(&export_dir);
    Ok(backup)
}

type TableCounts = Vec<(String, Option<i64>)>;

fn export_tables(path: &Path, export_dir: &Path) -> Result<TableCounts, RecordingError> {
    let connection = Connection::open(path)?;
    let counts = table_counts(&connection)?;
    std::fs::create_dir_all(export_dir)?;
    connection.execute_batch(&format!(
        "EXPORT DATABASE {} (FORMAT PARQUET);",
        quoted(export_dir)
    ))?;
    drop(connection);
    Ok(counts)
}

fn import_tables(staged: &Path, export_dir: &Path) -> Result<TableCounts, RecordingError> {
    let connection = Connection::open(staged)?;
    connection.execute_batch(&format!("IMPORT DATABASE {};", quoted(export_dir)))?;
    connection.execute_batch("CHECKPOINT;")?;
    let counts = table_counts(&connection)?;
    drop(connection);
    Ok(counts)
}

/// Row counts per table; `None` marks a table the database does not have yet.
fn table_counts(connection: &Connection) -> Result<TableCounts, RecordingError> {
    TABLES
        .iter()
        .map(|table| {
            connection
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get::<_, i64>(0)
                })
                .map_or_else(
                    |_| Ok(((*table).to_string(), None)),
                    |count| Ok(((*table).to_string(), Some(count))),
                )
        })
        .collect()
}

fn swap_in(path: &Path, staged: &Path, backup: &Path) -> Result<(), RecordingError> {
    let source_wal = wal_path(path);
    let backup_wal = wal_path(backup);
    let had_wal = source_wal.try_exists()?;
    let swap = (|| -> std::io::Result<()> {
        std::fs::rename(path, backup)?;
        if had_wal {
            // A leftover write-ahead log must travel with the file it belongs to,
            // otherwise it would be replayed onto the replacement database.
            std::fs::rename(&source_wal, &backup_wal)?;
        }
        std::fs::rename(staged, path)
    })();
    if let Err(error) = swap {
        let _ = std::fs::rename(backup, path);
        if had_wal {
            let _ = std::fs::rename(&backup_wal, &source_wal);
        }
        return Err(error.into());
    }
    Ok(())
}

fn discard(staged: &Path, export_dir: &Path) {
    remove_file(staged);
    remove_file(&wal_path(staged));
    remove_directory(export_dir);
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let name = path.file_name().map_or_else(
        || "recording.duckdb".to_string(),
        |name| name.to_string_lossy().into_owned(),
    );
    path.with_file_name(format!("{name}{suffix}"))
}

fn wal_path(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.wal", path.display()))
}

fn quoted(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "''"))
}

fn stamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis())
}

fn remove_file(path: &Path) {
    let _ = std::fs::remove_file(path);
}

fn remove_directory(path: &Path) {
    let _ = std::fs::remove_dir_all(path);
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

    const SEEDS: &str = "INSERT INTO recording_sessions VALUES ('keep', 1, 2, 'stopped'), ('drop', 3, 4, 'failed'); \
         INSERT INTO display_bindings VALUES ('b1', 'drop', 'c', 's', 'h', 'bytes', 'records', 1, NULL); \
         INSERT INTO recording_batches \
            SELECT range, 'drop', 'b1', 'bytes', 1, range, range, range, range, 1, 8, 0, \
                   repeat('x', 8)::BLOB, range \
            FROM range(50);";

    fn seeded(path: &Path) -> TableCounts {
        let connection = Connection::open(path).unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        connection.execute_batch(SEEDS).unwrap();
        let counts = table_counts(&connection).unwrap();
        drop(connection);
        counts
    }

    #[test]
    fn recognizes_catalog_damage_only() {
        let damaged = RecordingError::Failed(
            "database error: Catalog Error: Table with name recording_batches_cleanup does not exist! \
             Did you mean \"recording_batches\"?"
                .into(),
        );
        assert!(is_catalog_damage(&damaged));
        assert!(!is_catalog_damage(&RecordingError::Invalid("boom".into())));
        assert!(!is_catalog_damage(&RecordingError::Failed(
            "Constraint Error: Violates foreign key constraint".into()
        )));
    }

    #[test]
    fn rebuild_preserves_rows_and_keeps_a_backup() {
        let directory = std::env::temp_dir().join(format!("lissio-repair-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("acquisition.duckdb");
        let before = seeded(&path);

        let backup = rebuild_database(&path).unwrap();

        assert!(path.try_exists().unwrap());
        assert!(backup.try_exists().unwrap());
        let backup_name = backup.file_name().unwrap().to_string_lossy().into_owned();
        assert!(
            backup_name.contains(".corrupt-"),
            "unexpected backup: {backup_name}"
        );

        let connection = Connection::open(&path).unwrap();
        assert_eq!(table_counts(&connection).unwrap(), before);
        let indexes: i64 = connection
            .query_row(
                "SELECT count(*) FROM duckdb_indexes() WHERE index_name = 'recording_time_idx'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(indexes, 1);
        // The rebuilt database accepts the delete that used to fail.
        connection
            .execute_batch(
                "DELETE FROM display_bindings WHERE session_id = 'drop'; \
                 DELETE FROM recording_batches WHERE session_id = 'drop'; \
                 DELETE FROM recording_sessions WHERE id = 'drop';",
            )
            .unwrap();
        drop(connection);

        let leftovers: Vec<String> = std::fs::read_dir(&directory)
            .unwrap()
            .filter_map(std::result::Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(".repair-"))
            .collect();
        assert!(leftovers.is_empty(), "leftover repair files: {leftovers:?}");
        let _ = std::fs::remove_dir_all(&directory);
    }
}
