use duckdb::params;

use crate::codec;
use crate::store::{parse_domain, parse_state, to_duckdb_error};
use crate::{
    BindingCapability, BindingInfo, HistoryPage, HistoryQuery, RecordingDatabaseInfo,
    RecordingError, RecordingStore, SessionInfo, SessionSummary, StoredBatch,
};

impl RecordingStore {
    pub fn list_session_summaries(&self) -> Result<Vec<SessionSummary>, RecordingError> {
        let connection = self.connect_read_only()?;
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
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}

impl RecordingStore {
    pub fn list_bindings(&self, session_id: &str) -> Result<Vec<BindingInfo>, RecordingError> {
        let connection = self.connect_read_only()?;
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
        let connection = self.connect_read_only()?;
        let file_size_bytes = std::fs::metadata(self.path()).map_or(0, |metadata| metadata.len());
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
            path: self.path().to_string_lossy().into_owned(),
            file_size_bytes,
            session_count,
            batch_count,
            item_count,
            effective_bytes,
        })
    }
}

impl RecordingStore {
    pub fn history_page_query(&self, query: &HistoryQuery) -> Result<HistoryPage, RecordingError> {
        let limit = if query.include_payload {
            query.limit.clamp(1, 1_000)
        } else {
            query.limit.clamp(1, 10_000)
        };
        let connection = self.connect_read_only()?;
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

fn parse_capability(value: &str) -> BindingCapability {
    match value {
        "scalar" => BindingCapability::Scalar,
        "text" => BindingCapability::Text,
        "records" => BindingCapability::Records,
        "curve" => BindingCapability::Curve,
        _ => BindingCapability::Raw,
    }
}
