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

/// 文件级损坏 — 连打开都做不到: DuckDB 反序列化不了自己的元数据块, 或者文件被截断 /
/// 根本不是数据库文件。
///
/// 与 catalog 损坏的处置不同: 这条路**没有任何内容读得出来**, 所以不走
/// [`rebuild_database`] (那条路要先 `EXPORT DATABASE`), 而是见
/// [`quarantine_database`]。
///
/// 匹配的三个串都是 `Connection::open` 实测给出的: 元数据块损坏 (Serialization
/// Error)、垃圾内容或空文件 (not a valid DuckDB database file)、被截断
/// (Could not read enough bytes)。漏判的代价是录制一直不可用, 所以只在**打开
/// 失败**时用它判断。
pub fn is_unreadable(error: &RecordingError) -> bool {
    let message = error.to_string();
    message.contains("Failed to deserialize")
        || message.contains("not a valid DuckDB database file")
        || message.contains("Could not read enough bytes from file")
}

/// 打开即校验 — 强制真读一遍三张表, 让 catalog 损坏在**写入之前**暴露。
///
/// `CREATE TABLE IF NOT EXISTS` 在 catalog 指着一张其实不存在的表时不会报错, 只有
/// 真正读表才会抛 `Catalog Error: ... does not exist`; 所以校验必须是真读, 不能靠
/// 建表语句。调用方据 [`is_catalog_damage`] 决定是否走 [`rebuild_database`]。
pub fn verify_catalog(connection: &Connection) -> Result<(), RecordingError> {
    TABLES
        .iter()
        .try_for_each(|table| -> Result<(), RecordingError> {
            connection.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get::<_, i64>(0)
            })?;
            Ok(())
        })
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
    let backup = corrupt_backup_path(path, stamp);

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

/// 隔离一个**打不开**的数据库文件: 原名移到 `.corrupt-<stamp>.duckdb` (字节原样保留),
/// 让调用方在干净路径上新建空库。
///
/// 与 [`rebuild_database`] 的分工: 那条路要先 `EXPORT DATABASE` 把能读到的行搬进新库,
/// 只有**读得动**的文件才谈得上搬; 文件级损坏连打开都失败 ([`is_unreadable`]), 所以
/// 这里不尝试导出 — 保住原件、新建空库, 并由调用方把「原件在哪」告诉用户。
///
/// # Errors
/// 源文件移动失败 (权限 / 路径不存在) 时返回原因。
pub fn quarantine_database(path: &Path) -> Result<PathBuf, RecordingError> {
    let backup = corrupt_backup_path(path, stamp());
    std::fs::rename(path, &backup)?;
    let source_wal = wal_path(path);
    if source_wal.try_exists()? {
        // 残留 WAL 必须跟着它所属的文件走, 否则会被重放到新库上。
        std::fs::rename(&source_wal, wal_path(&backup))?;
    }
    Ok(backup)
}

/// 损坏原件的保留路径 — 重建与隔离共用同一条命名约定。
fn corrupt_backup_path(path: &Path, stamp: u128) -> PathBuf {
    path.with_file_name(format!(
        "{}.corrupt-{stamp}.duckdb",
        path.file_stem().map_or_else(
            || "recording".to_string(),
            |stem| stem.to_string_lossy().into_owned()
        )
    ))
}

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

    /// 打开即校验的判定依据: 一个「catalog 指着不存在的表」的库必须被认出来。
    /// 空文件正是这种形状 — 表从未建过, `CREATE TABLE IF NOT EXISTS` 也救不了。
    #[test]
    fn verify_catalog_flags_a_database_without_our_tables() {
        let directory = std::env::temp_dir().join(format!("lissio-verify-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("empty.duckdb");

        let connection = Connection::open(&path).unwrap();
        let error = verify_catalog(&connection).unwrap_err();
        assert!(
            is_catalog_damage(&error),
            "缺表必须被判成 catalog 损坏, 否则打开时会带着坏库继续写: {error}"
        );
        drop(connection);

        // 建过表之后同一份校验必须通过 — 否则每次打开都会误判成损坏并重建。
        let connection = Connection::open(&path).unwrap();
        crate::schema::initialize(&connection).unwrap();
        verify_catalog(&connection).unwrap();
        drop(connection);
        let _ = std::fs::remove_dir_all(&directory);
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

    /// 回归: 打不开的文件必须被**原样**挪到 `.corrupt-*`, 而不是被删掉或就地覆盖 —
    /// 用户只有这一份数据, 隔离是唯一安全的处置。
    #[test]
    fn quarantine_keeps_the_unreadable_file_byte_for_byte() {
        let directory =
            std::env::temp_dir().join(format!("lissio-quarantine-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("acquisition.duckdb");
        let garbage = vec![0xAB_u8; 4096];
        std::fs::write(&path, &garbage).unwrap();

        let backup = quarantine_database(&path).unwrap();

        assert!(!path.try_exists().unwrap(), "原名必须让出来给新库");
        assert_eq!(std::fs::read(&backup).unwrap(), garbage);
        assert!(
            backup
                .file_name()
                .unwrap()
                .to_string_lossy()
                .contains(".corrupt-"),
            "隔离件必须沿用损坏备份的命名约定: {backup:?}"
        );
        let _ = std::fs::remove_dir_all(&directory);
    }

    /// 文件级损坏的判定边界 — 漏判的代价是录制一直不可用, 误判的代价是把好库挪走,
    /// 所以两种损坏的处置必须严格分开。
    #[test]
    fn unreadable_matches_open_failures_only() {
        for message in [
            "database error: Serialization Error: Failed to deserialize: field id mismatch, \
             expected: 100, got: 25601",
            "IO Error: The file \"/tmp/x.duckdb\" exists, but it is not a valid DuckDB \
             database file!",
            "IO Error: Could not read enough bytes from file \"/tmp/x.duckdb\": attempted to \
             read 182955 bytes from location 91477",
        ] {
            assert!(
                is_unreadable(&RecordingError::Failed(message.into())),
                "必须认出来: {message}"
            );
        }
        // catalog 损坏是**读得动**的库: 它走导出重建, 绝不能被当成文件级损坏隔离掉。
        assert!(!is_unreadable(&RecordingError::Failed(
            "database error: Catalog Error: Table with name recording_batches does not exist!"
                .into()
        )));
        assert!(!is_unreadable(&RecordingError::Invalid("boom".into())));
    }
}
