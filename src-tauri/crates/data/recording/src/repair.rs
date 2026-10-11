//! Catalog damage detection and file-level repair.
//!
//! DuckDB can keep a foreign-key dependency on a table that no longer exists when
//! a schema change is interrupted. Every later `DELETE` on the referenced table
//! then fails with a catalog error that names the missing table, which made
//! history cleanup - and with it the recording panel - unusable.
//!
//! A second, worse failure mode lands here too (see [`is_index_damage`]): when the
//! time index no longer matches `recording_batches`, DuckDB escalates the failed
//! index deletion to a fatal error and invalidates the whole database instance, so
//! every later statement fails until the database is restarted. The file itself is
//! still readable, and rebuilding it re-creates the index from the table.
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

/// 索引与表不一致 — DuckDB 发现「要删的行在索引里找不到」时会先抛
/// `Invalid Input Error: Failed to delete all rows from index. Only deleted 0 out of N rows.`,
/// 随即由 commit 阶段的 `IndexDataRemover::Flush` **主动升级成 `FatalException`**,
/// 整个 `DatabaseInstance` 就此失效: 之后任何语句只报
/// `FATAL Error: Failed: database has been invalidated because of a previous fatal error.`
/// (原文里带着第一段错误)。
///
/// 库文件本身是**读得动**的, 导出重建 (顺带按表重建索引) 就能修好, 所以这两段文案
/// 必须和 catalog 损坏一样被认出来 — 否则 writer 会带着一个死掉的实例继续跑, 已受理
/// 的批次再也写不进去。真实库上撞到的就是这条: 索引停在 4695 行的旧快照, 之后 81480
/// 行都没进索引。
pub fn is_index_damage(error: &RecordingError) -> bool {
    let message = error.to_string();
    message.contains("Failed to delete all rows from index")
        || message.contains("database has been invalidated")
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
#[path = "repair_tests.rs"]
mod tests;
