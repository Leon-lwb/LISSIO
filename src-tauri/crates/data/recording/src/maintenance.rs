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
#[path = "maintenance_tests.rs"]
mod tests;
