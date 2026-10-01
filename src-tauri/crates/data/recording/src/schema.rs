//! 录制数据库的表结构 — 建表语句的唯一出处。
//!
//! 由打开路径 ([`crate::store`]) 与重建路径 ([`crate::repair`]) 共用: 重建后的
//! 空库必须与原库同构, 否则「修复」会把库换成一个 schema 不同的文件。

use duckdb::Connection;

use crate::RecordingError;

/// Create every table and index the recording database needs (idempotent).
pub fn initialize(connection: &Connection) -> Result<(), RecordingError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS recording_sessions( \
            id VARCHAR PRIMARY KEY, started_at_us UBIGINT NOT NULL, ended_at_us UBIGINT, state VARCHAR NOT NULL); \
         CREATE TABLE IF NOT EXISTS display_bindings( \
            id VARCHAR NOT NULL, session_id VARCHAR NOT NULL REFERENCES recording_sessions(id), \
            component_id VARCHAR NOT NULL, source_node_id VARCHAR NOT NULL, source_handle VARCHAR NOT NULL, \
            domain VARCHAR NOT NULL, capability VARCHAR NOT NULL, bound_at_us UBIGINT NOT NULL, unbound_at_us UBIGINT, \
            PRIMARY KEY(session_id, id)); \
         CREATE TABLE IF NOT EXISTS recording_batches( \
            row_id BIGINT PRIMARY KEY, session_id VARCHAR NOT NULL REFERENCES recording_sessions(id), \
            binding_id VARCHAR NOT NULL, domain VARCHAR NOT NULL, epoch UBIGINT NOT NULL, \
            sequence_start UBIGINT NOT NULL, sequence_end UBIGINT NOT NULL, \
            first_timestamp_us UBIGINT NOT NULL, last_timestamp_us UBIGINT NOT NULL, \
            item_count UBIGINT NOT NULL, effective_bytes UBIGINT NOT NULL, checksum UBIGINT NOT NULL, \
            payload BLOB NOT NULL, committed_at_us UBIGINT NOT NULL); \
         CREATE INDEX IF NOT EXISTS recording_time_idx ON recording_batches(session_id, binding_id, first_timestamp_us);",
    )?;
    Ok(())
}
