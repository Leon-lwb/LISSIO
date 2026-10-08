//! SeaORM read statements — historical sessions, bindings, database info, and
//! read-only SQL.
//!
//! Split from [`super::sea_sql`] so both stay inside the file-size limit; the
//! shared value codecs and the statement builder live there.

use std::path::Path;

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, QueryResult, Statement, Value};

use super::sea_sql::{
    database_error, get_i64, get_optional_u64, get_string, get_u64, map_error, optional_text_value,
    optional_u64_value, parse_capability, parse_domain, parse_state, statement,
};
use crate::codec;
use crate::{
    BindingInfo, HistoryPage, HistoryQuery, RecordingDatabaseInfo, RecordingError, SessionInfo,
    SessionSummary, SqlResult, StoredBatch,
};

pub async fn list_sessions(
    connection: &DatabaseConnection,
) -> Result<Vec<SessionInfo>, RecordingError> {
    let rows = connection
        .query_all_raw(statement(
            "SELECT id, started_at_us, ended_at_us, state FROM recording_sessions \
             ORDER BY started_at_us DESC",
            [],
        ))
        .await
        .map_err(database_error)?;
    rows.iter().map(session_row).collect()
}

fn session_row(row: &QueryResult) -> Result<SessionInfo, RecordingError> {
    let state = get_string(row, 3)?;
    Ok(SessionInfo {
        id: get_string(row, 0)?,
        started_at_us: get_u64(row, 1)?,
        ended_at_us: get_optional_u64(row, 2)?,
        state: parse_state(&state),
    })
}

pub async fn session_is_empty(
    connection: &DatabaseConnection,
    session_id: &str,
) -> Result<bool, RecordingError> {
    let row = connection
        .query_one_raw(statement(
            "SELECT count(*) FROM recording_batches WHERE session_id = ?",
            [Value::from(session_id)],
        ))
        .await
        .map_err(database_error)?
        .ok_or_else(|| RecordingError::Failed("count(*) returned no row".into()))?;
    Ok(get_i64(&row, 0)? == 0)
}

pub async fn list_session_summaries(
    connection: &DatabaseConnection,
) -> Result<Vec<SessionSummary>, RecordingError> {
    let rows = connection
        .query_all_raw(statement(
            "SELECT s.id, s.started_at_us, s.ended_at_us, s.state, \
                    count(DISTINCT b.binding_id) AS binding_count, \
                    count(b.row_id) AS batch_count, \
                    coalesce(sum(b.item_count), 0) AS item_count, \
                    coalesce(sum(b.effective_bytes), 0) AS effective_bytes, \
                    min(b.first_timestamp_us) AS first_timestamp_us, \
                    max(b.last_timestamp_us) AS last_timestamp_us \
             FROM recording_sessions s \
             LEFT JOIN recording_batches b ON b.session_id=s.id \
             GROUP BY s.id, s.started_at_us, s.ended_at_us, s.state \
             ORDER BY s.started_at_us DESC",
            [],
        ))
        .await
        .map_err(database_error)?;
    rows.iter().map(summary_row).collect()
}

fn summary_row(row: &QueryResult) -> Result<SessionSummary, RecordingError> {
    let state = get_string(row, 3)?;
    Ok(SessionSummary {
        session: SessionInfo {
            id: get_string(row, 0)?,
            started_at_us: get_u64(row, 1)?,
            ended_at_us: get_optional_u64(row, 2)?,
            state: parse_state(&state),
        },
        binding_count: get_u64(row, 4)?,
        batch_count: get_u64(row, 5)?,
        item_count: get_u64(row, 6)?,
        effective_bytes: get_u64(row, 7)?,
        first_timestamp_us: get_optional_u64(row, 8)?,
        last_timestamp_us: get_optional_u64(row, 9)?,
        active: false,
    })
}

pub async fn list_bindings(
    connection: &DatabaseConnection,
    session_id: &str,
) -> Result<Vec<BindingInfo>, RecordingError> {
    let rows = connection
        .query_all_raw(statement(
            "SELECT id, session_id, component_id, source_node_id, source_handle, domain, \
                    capability, bound_at_us, unbound_at_us \
             FROM display_bindings WHERE session_id=? ORDER BY bound_at_us, id",
            [Value::from(session_id)],
        ))
        .await
        .map_err(database_error)?;
    rows.iter().map(binding_row).collect()
}

fn binding_row(row: &QueryResult) -> Result<BindingInfo, RecordingError> {
    let domain = get_string(row, 5)?;
    let capability = get_string(row, 6)?;
    Ok(BindingInfo {
        id: get_string(row, 0)?,
        session_id: get_string(row, 1)?,
        component_id: get_string(row, 2)?,
        source_node_id: get_string(row, 3)?,
        source_handle: get_string(row, 4)?,
        domain: parse_domain(&domain),
        capability: parse_capability(&capability),
        bound_at_us: get_u64(row, 7)?,
        unbound_at_us: get_optional_u64(row, 8)?,
    })
}

/// Database counters; row counts come from the connection and the file size from
/// the filesystem.
pub async fn database_info(
    connection: &DatabaseConnection,
    path: &Path,
) -> Result<RecordingDatabaseInfo, RecordingError> {
    let file_size_bytes = std::fs::metadata(path).map_or(0, |metadata| metadata.len());
    Ok(RecordingDatabaseInfo {
        path: path.to_string_lossy().into_owned(),
        file_size_bytes,
        session_count: aggregate(connection, "SELECT count(*) FROM recording_sessions").await?,
        batch_count: aggregate(connection, "SELECT count(*) FROM recording_batches").await?,
        item_count: aggregate(
            connection,
            "SELECT coalesce(sum(item_count), 0) FROM recording_batches",
        )
        .await?,
        effective_bytes: aggregate(
            connection,
            "SELECT coalesce(sum(effective_bytes), 0) FROM recording_batches",
        )
        .await?,
    })
}

async fn aggregate(connection: &DatabaseConnection, sql: &str) -> Result<u64, RecordingError> {
    let row = connection
        .query_one_raw(statement(sql, []))
        .await
        .map_err(database_error)?
        .ok_or_else(|| RecordingError::Failed("aggregate query returned no row".into()))?;
    get_u64(&row, 0)
}

pub async fn history_page(
    connection: &DatabaseConnection,
    query: &HistoryQuery,
) -> Result<HistoryPage, RecordingError> {
    let limit = if query.include_payload {
        query.limit.clamp(1, 1_000)
    } else {
        query.limit.clamp(1, 10_000)
    };
    let binding_id = query.binding_id.as_deref();
    let rows = connection
        .query_all_raw(statement(
            "SELECT row_id, session_id, binding_id, domain, epoch, sequence_start, sequence_end, \
                    first_timestamp_us, last_timestamp_us, item_count, effective_bytes, checksum, payload \
             FROM recording_batches \
             WHERE session_id=? AND row_id>? AND (? IS NULL OR binding_id=?) \
               AND (? IS NULL OR last_timestamp_us >= ?) \
               AND (? IS NULL OR first_timestamp_us <= ?) \
             ORDER BY row_id LIMIT ?",
            [
                Value::from(&query.session_id),
                Value::from(query.after_row_id),
                optional_text_value(binding_id),
                optional_text_value(binding_id),
                optional_u64_value(query.from_us),
                optional_u64_value(query.from_us),
                optional_u64_value(query.to_us),
                optional_u64_value(query.to_us),
                Value::from(i64::try_from(limit).unwrap_or(i64::MAX)),
            ],
        ))
        .await
        .map_err(database_error)?;
    let rows = rows
        .iter()
        .map(|row| stored_batch_row(row, query.include_payload))
        .collect::<Result<Vec<_>, _>>()?;
    let next_row_id = (rows.len() == limit)
        .then(|| rows.last().map(|row| row.row_id))
        .flatten();
    Ok(HistoryPage { rows, next_row_id })
}

fn stored_batch_row(
    row: &QueryResult,
    include_payload: bool,
) -> Result<StoredBatch, RecordingError> {
    let domain_name = get_string(row, 3)?;
    let domain = parse_domain(&domain_name);
    let payload = if include_payload {
        let bytes = map_error(row.try_get_by_index::<Vec<u8>>(12))?;
        // The codec error is already the store's own `Corrupt`; unlike DuckDB
        // there is no engine error variant to funnel it through.
        Some(codec::decode(domain, &bytes)?)
    } else {
        None
    };
    Ok(StoredBatch {
        row_id: get_i64(row, 0)?,
        session_id: get_string(row, 1)?,
        binding_id: get_string(row, 2)?,
        domain,
        epoch: get_u64(row, 4)?,
        sequence_start: get_u64(row, 5)?,
        sequence_end: get_u64(row, 6)?,
        first_timestamp_us: get_u64(row, 7)?,
        last_timestamp_us: get_u64(row, 8)?,
        item_count: get_u64(row, 9)?,
        effective_bytes: get_u64(row, 10)?,
        checksum: get_u64(row, 11)?,
        payload,
    })
}

/// Run one read-only `SELECT`/`WITH` and return rows as JSON objects.
pub async fn query_sql(
    connection: &DatabaseConnection,
    sql: &str,
    max_rows: usize,
) -> Result<SqlResult, RecordingError> {
    let normalized = sql.trim_start().to_ascii_lowercase();
    if !(normalized.starts_with("select ") || normalized.starts_with("with ")) || sql.contains(';')
    {
        return Err(RecordingError::Invalid(
            "historical SQL must be one SELECT or WITH query".into(),
        ));
    }
    let max_rows = max_rows.clamp(1, 100_000);
    let wrapped = format!(
        "SELECT * FROM ({sql}) AS result_row LIMIT {}",
        max_rows.saturating_add(1)
    );
    let rows = connection
        .query_all_raw(Statement::from_string(DbBackend::Sqlite, wrapped))
        .await
        .map_err(database_error)?;
    let mut rows = rows.iter().map(row_json).collect::<Vec<_>>();
    let truncated = rows.len() > max_rows;
    rows.truncate(max_rows);
    Ok(SqlResult { rows, truncated })
}

fn row_json(row: &QueryResult) -> serde_json::Value {
    let columns = row.column_names();
    let mut object = serde_json::Map::with_capacity(columns.len());
    for (index, name) in columns.iter().enumerate() {
        object.insert(name.clone(), column_json(row, index));
    }
    serde_json::Value::Object(object)
}

/// DuckDB exposes a typed value ref; SeaORM only offers decode-by-Rust-type, so
/// the column is probed in DuckDB's order — integer, float, text, binary, null —
/// and the binary case mirrors DuckDB's `"<binary:N bytes>"` placeholder.
fn column_json(row: &QueryResult, index: usize) -> serde_json::Value {
    if let Ok(Some(value)) = row.try_get_by_index::<Option<i64>>(index) {
        return serde_json::Value::from(value);
    }
    if let Ok(Some(value)) = row.try_get_by_index::<Option<f64>>(index) {
        return serde_json::Number::from_f64(value)
            .map_or(serde_json::Value::Null, serde_json::Value::Number);
    }
    if let Ok(Some(value)) = row.try_get_by_index::<Option<String>>(index) {
        return serde_json::Value::from(value);
    }
    if let Ok(Some(value)) = row.try_get_by_index::<Option<Vec<u8>>>(index) {
        return serde_json::Value::from(format!("<binary:{} bytes>", value.len()));
    }
    serde_json::Value::Null
}
