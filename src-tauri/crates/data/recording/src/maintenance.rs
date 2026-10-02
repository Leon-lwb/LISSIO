use duckdb::{Connection, params, params_from_iter};

use crate::{RecordingCleanupResult, RecordingError};

/// Time index over recorded batches.
///
/// **删批次之前必须先摘掉它。** DuckDB 在 commit 阶段从索引里删除被删行的条目,
/// 一旦索引与表对不上 (例如索引是陈旧快照), `BoundIndex::Delete` 会抛
/// `InvalidInputException("Failed to delete all rows from index")`, 而
/// `IndexDataRemover::Flush` 会**主动把它升级成 `FatalException`**, 于是整个
/// `DatabaseInstance` 立刻失效 — 之后任何语句都只报
/// 「database has been invalidated because of a previous fatal error」, 连兜底的
/// `DROP INDEX` 都跑不了, writer 线程随之报废。
///
/// 这个索引只服务历史查询; 重建它的代价远小于一次「库被毒化」, 所以删除路径一律
/// **先摘索引再删行**, 删完由 [`create_time_index`] 按剩余行重建 — 顺带把陈旧的
/// 索引一起修好。
pub const TIME_INDEX: &str = "recording_time_idx";

/// 时间索引的列 — 建索引语句的唯一出处 (schema 里那条与之同构)。
const TIME_INDEX_COLUMNS: &str = "recording_batches(session_id, binding_id, first_timestamp_us)";

/// 摘掉时间索引 — 删除批次前的第一步, 幂等。
pub fn drop_time_index(connection: &Connection) -> Result<(), RecordingError> {
    connection.execute_batch(&format!("DROP INDEX IF EXISTS {TIME_INDEX};"))?;
    Ok(())
}

/// 按表当前内容重建时间索引 — 索引只是优化, 失败由调用方决定是否忽略。
pub fn create_time_index(connection: &Connection) -> Result<(), RecordingError> {
    connection.execute_batch(&format!(
        "CREATE INDEX IF NOT EXISTS {TIME_INDEX} ON {TIME_INDEX_COLUMNS};"
    ))?;
    Ok(())
}

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
    let mut skipped: Vec<(&str, String)> = Vec::new();
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
            Err(error) => {
                skipped.push((id, first_line(&error)));
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
            Err(error) => skipped.push((id, first_line(&error))),
        }
    }

    if index_dropped {
        // The index is only an optimization; a failure here must not undo a cleanup.
        let _ = create_time_index(connection);
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

/// 删一个会话的全部批次 — **先摘时间索引**, 再删行。
///
/// 顺序不能反过来: 老实现先带索引删、失败后再 `DROP INDEX` 补救, 但那时实例已经被
/// DuckDB 打成 FATAL (见 [`TIME_INDEX`]), 补救语句只会拿到
/// 「database has been invalidated」, 清理于是彻底做不成。
fn delete_batches(
    connection: &Connection,
    id: &str,
    index_dropped: &mut bool,
) -> Result<(), RecordingError> {
    if !*index_dropped {
        drop_time_index(connection)?;
        *index_dropped = true;
    }
    connection.execute(
        "DELETE FROM recording_batches WHERE session_id = ?",
        params![id],
    )?;
    Ok(())
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

/// 只有**文件级重建能修好**的失败才值得把清理升级成一次重建; 其余一律记成
/// skipped 会话, 保证面板永不被一次清理卡死。
///
/// 这里包含两件事: catalog 损坏 (旧账), 以及索引与表不一致 / 实例被判死 — 后者在
/// 真实库里就是「Failed to delete all rows from index」→「database has been
/// invalidated」这两段文案, 只有导出重建 (顺带按表重建索引) 能救。
fn is_repairable(error: &RecordingError) -> bool {
    crate::repair::is_catalog_damage(error) || crate::repair::is_index_damage(error)
}

/// 用户可见的原因只取首行 — DuckDB 的 chunk dump 有上千行, 整段塞进界面提示没有意义。
fn first_line(error: &RecordingError) -> String {
    error
        .to_string()
        .lines()
        .next()
        .unwrap_or_default()
        .to_string()
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
}
