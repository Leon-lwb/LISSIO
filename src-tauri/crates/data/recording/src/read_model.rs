//! 读模型 — 历史会话、绑定、库信息与只读 SQL。
//!
//! **每一条读都走写线程的唯一连接** ([`RecordingStore::reader`])。曾经每个查询 /
//! 检查都自己 `Connection::open` 一个实例, 多个实例会各自 checkpoint 并互相覆盖,
//! 静默抹掉已提交写入; 没有挂载写线程时 (构造期、修复路径、测试直接打开) 才退化
//! 为独占打开, 且同一份语句实现只写一遍 (`*_on`)。

use duckdb::types::ValueRef;
use duckdb::{Connection, params};

use crate::codec;
use crate::store::{parse_domain, parse_state, to_duckdb_error};
use crate::{
    BindingCapability, BindingInfo, HistoryPage, HistoryQuery, RecordingDatabaseInfo,
    RecordingError, RecordingStore, SessionInfo, SessionSummary, SqlResult, StoredBatch,
};

impl RecordingStore {
    pub fn list_sessions(&self) -> Result<Vec<SessionInfo>, RecordingError> {
        match self.reader() {
            Some(reader) => reader.sessions(),
            None => Self::list_sessions_on(&self.connect_read_only()?),
        }
    }

    pub(crate) fn list_sessions_on(
        connection: &Connection,
    ) -> Result<Vec<SessionInfo>, RecordingError> {
        let mut statement = connection.prepare(
            "SELECT id, started_at_us, ended_at_us, state FROM recording_sessions \
             ORDER BY started_at_us DESC",
        )?;
        let rows = statement.query_map([], |row| {
            let state: String = row.get(3)?;
            Ok(SessionInfo {
                id: row.get(0)?,
                started_at_us: row.get(1)?,
                ended_at_us: row.get(2)?,
                state: parse_state(&state),
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}

impl RecordingStore {
    /// Whether the session holds no batches at all (shared by the startup
    /// continuation probes).
    pub(crate) fn session_is_empty(&self, session_id: &str) -> Result<bool, RecordingError> {
        match self.reader() {
            Some(reader) => reader.session_is_empty(session_id),
            None => Self::session_is_empty_on(&self.connect()?, session_id),
        }
    }

    pub(crate) fn session_is_empty_on(
        connection: &Connection,
        session_id: &str,
    ) -> Result<bool, RecordingError> {
        let count: i64 = connection.query_row(
            "SELECT count(*) FROM recording_batches WHERE session_id = ?",
            params![session_id],
            |row| row.get(0),
        )?;
        Ok(count == 0)
    }
}

impl RecordingStore {
    pub fn list_session_summaries(&self) -> Result<Vec<SessionSummary>, RecordingError> {
        match self.reader() {
            Some(reader) => reader.session_summaries(),
            None => Self::list_session_summaries_on(&self.connect_read_only()?),
        }
    }

    pub(crate) fn list_session_summaries_on(
        connection: &Connection,
    ) -> Result<Vec<SessionSummary>, RecordingError> {
        let mut statement = connection.prepare(
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
        )?;
        let rows = statement.query_map([], |row| {
            let state: String = row.get(3)?;
            Ok(SessionSummary {
                session: SessionInfo {
                    id: row.get(0)?,
                    started_at_us: row.get(1)?,
                    ended_at_us: row.get(2)?,
                    state: parse_state(&state),
                },
                binding_count: row.get(4)?,
                batch_count: row.get(5)?,
                item_count: row.get(6)?,
                effective_bytes: row.get(7)?,
                first_timestamp_us: row.get(8)?,
                last_timestamp_us: row.get(9)?,
                active: false,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}

impl RecordingStore {
    pub fn list_bindings(&self, session_id: &str) -> Result<Vec<BindingInfo>, RecordingError> {
        match self.reader() {
            Some(reader) => reader.bindings(session_id),
            None => Self::list_bindings_on(&self.connect_read_only()?, session_id),
        }
    }

    pub(crate) fn list_bindings_on(
        connection: &Connection,
        session_id: &str,
    ) -> Result<Vec<BindingInfo>, RecordingError> {
        let mut statement = connection.prepare(
            "SELECT id, session_id, component_id, source_node_id, source_handle, domain, \
                    capability, bound_at_us, unbound_at_us \
             FROM display_bindings WHERE session_id=? ORDER BY bound_at_us, id",
        )?;
        let rows = statement.query_map(params![session_id], |row| {
            let domain_name: String = row.get(5)?;
            let capability_name: String = row.get(6)?;
            Ok(BindingInfo {
                id: row.get(0)?,
                session_id: row.get(1)?,
                component_id: row.get(2)?,
                source_node_id: row.get(3)?,
                source_handle: row.get(4)?,
                domain: parse_domain(&domain_name),
                capability: parse_capability(&capability_name),
                bound_at_us: row.get(7)?,
                unbound_at_us: row.get(8)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}

impl RecordingStore {
    pub fn database_info(&self) -> Result<RecordingDatabaseInfo, RecordingError> {
        match self.reader() {
            Some(reader) => reader.database_info(),
            None => Self::database_info_on(self, &self.connect_read_only()?),
        }
    }

    /// 库信息 — 行数来自唯一连接, 文件大小来自文件系统。
    pub(crate) fn database_info_on(
        store: &Self,
        connection: &Connection,
    ) -> Result<RecordingDatabaseInfo, RecordingError> {
        let file_size_bytes = std::fs::metadata(store.path()).map_or(0, |metadata| metadata.len());
        let session_count: u64 =
            connection.query_row("SELECT count(*) FROM recording_sessions", [], |row| {
                row.get(0)
            })?;
        let batch_count: u64 =
            connection.query_row("SELECT count(*) FROM recording_batches", [], |row| {
                row.get(0)
            })?;
        let item_count: u64 = connection.query_row(
            "SELECT coalesce(sum(item_count), 0) FROM recording_batches",
            [],
            |row| row.get(0),
        )?;
        let effective_bytes: u64 = connection.query_row(
            "SELECT coalesce(sum(effective_bytes), 0) FROM recording_batches",
            [],
            |row| row.get(0),
        )?;
        Ok(RecordingDatabaseInfo {
            path: store.path().to_string_lossy().into_owned(),
            file_size_bytes,
            session_count,
            batch_count,
            item_count,
            effective_bytes,
        })
    }
}

impl RecordingStore {
    pub fn history_page(
        &self,
        session_id: &str,
        binding_id: Option<&str>,
        after_row_id: i64,
        limit: usize,
        include_payload: bool,
    ) -> Result<HistoryPage, RecordingError> {
        self.history_page_query(&HistoryQuery {
            session_id: session_id.to_string(),
            binding_id: binding_id.map(ToString::to_string),
            after_row_id,
            from_us: None,
            to_us: None,
            limit,
            include_payload,
        })
    }

    pub fn history_page_query(&self, query: &HistoryQuery) -> Result<HistoryPage, RecordingError> {
        match self.reader() {
            Some(reader) => reader.history_page(query.clone()),
            None => Self::history_page_query_on(&self.connect_read_only()?, query),
        }
    }

    pub(crate) fn history_page_query_on(
        connection: &Connection,
        query: &HistoryQuery,
    ) -> Result<HistoryPage, RecordingError> {
        let limit = if query.include_payload {
            query.limit.clamp(1, 1_000)
        } else {
            query.limit.clamp(1, 10_000)
        };
        let mut statement = connection.prepare(
            "SELECT row_id, session_id, binding_id, domain, epoch, sequence_start, sequence_end, \
                    first_timestamp_us, last_timestamp_us, item_count, effective_bytes, checksum, payload \
             FROM recording_batches \
             WHERE session_id=? AND row_id>? AND (? IS NULL OR binding_id=?) \
               AND (? IS NULL OR last_timestamp_us >= ?) \
               AND (? IS NULL OR first_timestamp_us <= ?) \
             ORDER BY row_id LIMIT ?",
        )?;
        let binding_id = query.binding_id.as_deref();
        let rows = statement.query_map(
            params![
                &query.session_id,
                query.after_row_id,
                binding_id,
                binding_id,
                query.from_us,
                query.from_us,
                query.to_us,
                query.to_us,
                limit as u64
            ],
            |row| {
                let domain_name: String = row.get(3)?;
                let domain = parse_domain(&domain_name);
                let bytes: Vec<u8> = row.get(12)?;
                let payload = if query.include_payload {
                    Some(codec::decode(domain, &bytes).map_err(to_duckdb_error)?)
                } else {
                    None
                };
                Ok(StoredBatch {
                    row_id: row.get(0)?,
                    session_id: row.get(1)?,
                    binding_id: row.get(2)?,
                    domain,
                    epoch: row.get(4)?,
                    sequence_start: row.get(5)?,
                    sequence_end: row.get(6)?,
                    first_timestamp_us: row.get(7)?,
                    last_timestamp_us: row.get(8)?,
                    item_count: row.get(9)?,
                    effective_bytes: row.get(10)?,
                    checksum: row.get(11)?,
                    payload,
                })
            },
        )?;
        let rows = rows.collect::<Result<Vec<_>, _>>()?;
        let next_row_id = (rows.len() == limit)
            .then(|| rows.last().map(|row| row.row_id))
            .flatten();
        Ok(HistoryPage { rows, next_row_id })
    }
}

impl RecordingStore {
    /// Run one read-only SELECT and return rows as JSON objects.
    ///
    /// 只允许单条 SELECT / WITH; 语句在写线程的唯一连接上执行。
    pub(crate) fn query_sql_on(
        connection: &Connection,
        sql: &str,
        max_rows: usize,
    ) -> Result<SqlResult, RecordingError> {
        let normalized = sql.trim_start().to_ascii_lowercase();
        if !(normalized.starts_with("select ") || normalized.starts_with("with "))
            || sql.contains(';')
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
        let mut statement = connection.prepare(&wrapped)?;
        let mut query = statement.query([])?;
        let columns = query
            .as_ref()
            .expect("query rows retain their statement")
            .column_names();
        let mut rows = Vec::new();
        while let Some(row) = query.next()? {
            let mut object = serde_json::Map::with_capacity(columns.len());
            for (index, name) in columns.iter().enumerate() {
                object.insert(name.clone(), value_json(row.get_ref(index)?));
            }
            rows.push(serde_json::Value::Object(object));
        }
        let truncated = rows.len() > max_rows;
        rows.truncate(max_rows);
        Ok(SqlResult { rows, truncated })
    }
}

fn parse_capability(value: &str) -> BindingCapability {
    match value {
        "scalar" => BindingCapability::Scalar,
        "text" => BindingCapability::Text,
        "records" => BindingCapability::Records,
        "curve" => BindingCapability::Curve,
        _ => BindingCapability::Raw,
    }
}

fn value_json(value: ValueRef<'_>) -> serde_json::Value {
    match value {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Boolean(value) => value.into(),
        ValueRef::TinyInt(value) => value.into(),
        ValueRef::SmallInt(value) => value.into(),
        ValueRef::Int(value) => value.into(),
        ValueRef::BigInt(value) => value.into(),
        ValueRef::UTinyInt(value) => value.into(),
        ValueRef::USmallInt(value) => value.into(),
        ValueRef::UInt(value) => value.into(),
        ValueRef::UBigInt(value) => value.into(),
        ValueRef::Float(value) => serde_json::Number::from_f64(f64::from(value))
            .map_or(serde_json::Value::Null, serde_json::Value::Number),
        ValueRef::Double(value) => serde_json::Number::from_f64(value)
            .map_or(serde_json::Value::Null, serde_json::Value::Number),
        ValueRef::Text(value) => String::from_utf8_lossy(value).into_owned().into(),
        ValueRef::Blob(value) | ValueRef::Geometry(value) => {
            format!("<binary:{} bytes>", value.len()).into()
        }
        ValueRef::HugeInt(value) => value.to_string().into(),
        ValueRef::UHugeInt(value) => value.to_string().into(),
        other => format!("{other:?}").into(),
    }
}
