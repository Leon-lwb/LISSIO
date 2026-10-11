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

fn time_index_count(connection: &Connection) -> i64 {
    connection
        .query_row(
            "SELECT count(*) FROM duckdb_indexes() WHERE index_name = 'recording_time_idx'",
            [],
            |row| row.get(0),
        )
        .unwrap()
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

/// 回归: 批次删除必须在**没有**时间索引的情况下执行。
///
/// 真实故障链 (2026-10-02 那次): 索引停在 4695 行的旧快照 → 带索引的
/// `DELETE FROM recording_batches` 在 commit 阶段删索引条目时对不上 →
/// `Failed to delete all rows from index` → DuckDB 升级成 FatalException →
/// 整个实例失效 → 后续任何语句只报「database has been invalidated」,
/// 清理做不成、writer 报废、录制再也写不进去。
#[test]
fn batch_deletion_detaches_the_time_index_first() {
    let connection = seeded();
    assert_eq!(time_index_count(&connection), 1);

    let mut index_dropped = false;
    delete_batches(&connection, "drop", &mut index_dropped).unwrap();

    assert!(index_dropped, "删除路径必须自己摘掉时间索引");
    assert_eq!(
        time_index_count(&connection),
        0,
        "DELETE 执行时时间索引必须已经不在了"
    );
}

/// 清理结束后索引必须按剩余行重建 — 陈旧索引正是在这一步被修好的。
#[test]
fn cleanup_rebuilds_the_time_index_for_the_surviving_rows() {
    let connection = seeded();
    delete_sessions_on(&connection, "current", &["drop".to_string()]).unwrap();
    assert_eq!(time_index_count(&connection), 1, "清理后索引必须回来");

    // 重建出来的索引必须真的可用: 再录一批, 再清一次。
    connection
            .execute_batch(
                "INSERT INTO recording_sessions VALUES ('again', 5, 6, 'stopped'); \
                 INSERT INTO display_bindings VALUES ('b2', 'again', 'c', 's', 'h', 'bytes', 'records', 1, NULL); \
                 INSERT INTO recording_batches \
                    SELECT 1000 + range, 'again', 'b2', 'bytes', 1, range, range, range, range, 1, 8, 0, \
                           repeat('y', 8)::BLOB, range \
                    FROM range(25);",
            )
            .unwrap();
    let result = delete_sessions_on(&connection, "current", &["again".to_string()]).unwrap();
    assert_eq!(result.deleted_batches, 25);
    assert!(result.warning.is_none());
    assert_eq!(time_index_count(&connection), 1);
}

/// 索引损坏必须走「重建库」而不是被记成 skipped 会话 —— 否则 writer 会带着一个
/// 已经失效的 DuckDB 实例继续跑。
#[test]
fn index_damage_is_repairable() {
    assert!(is_repairable(&RecordingError::Failed(
        "database error: FATAL Error: Failed: database has been invalidated because of a \
             previous fatal error. Original error: \"Invalid Input Error: Failed to delete all \
             rows from index.\""
            .into()
    )));
    // 其它失败仍然只算 skipped: 一次清理不该因为一个删不掉的会话就重建整库。
    assert!(!is_repairable(&RecordingError::Failed(
        "Constraint Error: Violates foreign key constraint".into()
    )));
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
