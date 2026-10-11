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

/// 回归: 真实库上撞到的两种文案都必须被判成「可重建」。
/// ① commit 阶段删索引条目对不上 (库还是活的); ② 实例因此失效后, 后续语句拿到的 FATAL。
#[test]
fn recognizes_index_damage_in_both_stages() {
    let failed_delete = RecordingError::Failed(
        "database error: FATAL Error: Invalid Input Error: Failed to delete all rows from \
             index. Only deleted 0 out of 1449 rows.\nChunk: Chunk - [14 Columns]\n- FLAT BIGINT: \
             1449 = [ 4696, 4697, ...]"
            .into(),
    );
    assert!(is_index_damage(&failed_delete), "①必须认出来");
    let invalidated = RecordingError::Failed(
        "database error: FATAL Error: Failed: database has been invalidated because of a \
             previous fatal error. The database must be restarted prior to being used again.\n\
             Original error: \"Invalid Input Error: Failed to delete all rows from index. Only \
             deleted 0 out of 1449 rows.\""
            .into(),
    );
    assert!(is_index_damage(&invalidated), "②必须认出来");
    // 不许误判: 把普通失败当索引损坏会让一次清理白白重建整库。
    assert!(!is_index_damage(&RecordingError::Invalid("boom".into())));
    assert!(!is_index_damage(&RecordingError::Failed(
        "Constraint Error: Violates foreign key constraint".into()
    )));
    assert!(!is_index_damage(&RecordingError::Failed(
        "database error: Catalog Error: Table with name recording_batches does not exist!".into()
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
    let directory = std::env::temp_dir().join(format!("lissio-quarantine-{}", std::process::id()));
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
        "database error: Catalog Error: Table with name recording_batches does not exist!".into()
    )));
    assert!(!is_unreadable(&RecordingError::Invalid("boom".into())));
}
