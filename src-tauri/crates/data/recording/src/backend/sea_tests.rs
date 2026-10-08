//! Port-level tests for the SeaORM engine.
//!
//! Everything here drives the engine through [`StoreEngine`] and [`StoreSession`]
//! — never through SQL literals — so the tests assert the store contract rather
//! than this engine's internals. The schema test at the bottom keeps the raw
//! table/upsert round trip that the port methods are built on.

use std::path::{Path, PathBuf};

use sea_orm::{ConnectionTrait, DbBackend, QueryResult, Statement, Value as SeaValue};

use super::sea::{SeaOrmEngine, connect_and_initialize, sqlite_url};
use crate::codec;
use crate::port::{StoreEngine, StoreSession};
use crate::writer::QueryCancellation;
use crate::{
    BatchPayload, BindingCapability, DisplayBinding, Domain, HistoryQuery, PortIdentity,
    RecordBatch, RecordingError, SessionInfo, SessionState,
};

/// One private directory per test so parallel tests never share a file.
fn database_path(name: &str) -> PathBuf {
    let directory =
        std::env::temp_dir().join(format!("lissio-seaorm-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&directory).expect("temp dir");
    let path = directory.join("acquisition.db");
    let _ = std::fs::remove_file(&path);
    path
}

fn remove_database(path: &Path) {
    if let Some(directory) = path.parent() {
        let _ = std::fs::remove_dir_all(directory);
    }
}

fn binding(id: &str, domain: Domain) -> DisplayBinding {
    DisplayBinding {
        id: id.to_string(),
        component_id: format!("component-{id}"),
        port: PortIdentity::new(format!("node-{id}"), format!("handle-{id}")),
        domain,
        capability: match domain {
            Domain::Bytes => BindingCapability::Records,
            Domain::String => BindingCapability::Text,
            Domain::Float => BindingCapability::Scalar,
            Domain::Spectrum => BindingCapability::Curve,
        },
    }
}

fn sample_bindings() -> Vec<DisplayBinding> {
    vec![
        binding("bytes", Domain::Bytes),
        binding("string", Domain::String),
        binding("float", Domain::Float),
        binding("spectrum", Domain::Spectrum),
    ]
}

fn record(
    binding_id: &str,
    sequence_start: u64,
    timestamps_us: Vec<u64>,
    payload: BatchPayload,
) -> RecordBatch {
    RecordBatch {
        binding_id: binding_id.to_string(),
        epoch: 3,
        sequence_start,
        timestamps_us,
        payload,
    }
}

fn sample_batches() -> Vec<RecordBatch> {
    vec![
        record(
            "bytes",
            0,
            vec![1_000],
            BatchPayload::Bytes {
                data: vec![0, 1, 2, 3],
            },
        ),
        record(
            "string",
            10,
            vec![2_000, 2_001],
            BatchPayload::String {
                values: vec!["alpha".into(), "beta".into()],
            },
        ),
        record(
            "float",
            20,
            vec![3_000, 3_001, 3_002],
            BatchPayload::Float {
                values: vec![1.5, -2.25, 0.0],
            },
        ),
        record(
            "spectrum",
            30,
            vec![4_000],
            BatchPayload::Spectrum {
                frequencies: vec![10.0, 20.0],
                values: vec![0.5, 0.25],
            },
        ),
    ]
}

/// Open a fresh database through the engine and write one batch per domain.
async fn seeded(
    name: &str,
) -> (
    PathBuf,
    Box<dyn StoreSession>,
    SessionInfo,
    Vec<RecordBatch>,
) {
    let path = database_path(name);
    let (mut session, note) = SeaOrmEngine
        .open(&path)
        .await
        .expect("open through the engine");
    assert!(note.is_none(), "SQLite needs no recovery note");
    let info = session
        .create_session(&sample_bindings())
        .await
        .expect("create session");
    assert_eq!(info.state, SessionState::Running);
    assert!(info.ended_at_us.is_none());

    let batches = sample_batches();
    for (index, batch) in batches.iter().enumerate() {
        let row_id = i64::try_from(index).unwrap_or(0) + 1;
        let written = session
            .write_batch(&info.id, row_id, batch)
            .await
            .expect("write batch");
        assert_eq!(
            written,
            batch.payload.effective_bytes(),
            "the returned byte count matches the payload"
        );
    }
    (path, session, info, batches)
}

fn query(session_id: &str, include_payload: bool) -> HistoryQuery {
    HistoryQuery {
        session_id: session_id.to_string(),
        binding_id: None,
        after_row_id: 0,
        from_us: None,
        to_us: None,
        limit: 100,
        include_payload,
    }
}

#[tokio::test]
async fn history_returns_every_domain_with_its_payload() {
    let (path, mut session, info, batches) = seeded("history").await;
    let page = session
        .history_page(&query(&info.id, true))
        .await
        .expect("history page");
    assert_eq!(page.rows.len(), 4);
    assert!(page.next_row_id.is_none(), "a short page has no cursor");

    for (index, (row, batch)) in page.rows.iter().zip(&batches).enumerate() {
        assert_eq!(row.row_id, i64::try_from(index).unwrap_or(0) + 1);
        assert_eq!(row.session_id, info.id);
        assert_eq!(row.binding_id, batch.binding_id);
        assert_eq!(row.domain, batch.payload.domain());
        assert_eq!(row.epoch, batch.epoch);
        assert_eq!(row.sequence_start, batch.sequence_start);
        assert_eq!(row.sequence_end, batch.sequence_end());
        assert_eq!(row.first_timestamp_us, batch.timestamps_us[0]);
        assert_eq!(
            row.last_timestamp_us,
            *batch.timestamps_us.last().unwrap_or(&0)
        );
        assert_eq!(
            row.item_count,
            u64::try_from(batch.payload.item_count()).unwrap_or(0)
        );
        assert_eq!(
            row.effective_bytes,
            u64::try_from(batch.payload.effective_bytes()).unwrap_or(0)
        );
        assert_eq!(
            row.checksum,
            codec::checksum(&codec::encode(&batch.payload).expect("encode payload"))
        );
        assert_eq!(
            row.payload.as_ref(),
            Some(&batch.payload),
            "the payload round-trips byte for byte"
        );
    }

    // Without payloads the metadata still pages, and a binding filter narrows it.
    let metadata = session
        .history_page(&query(&info.id, false))
        .await
        .expect("metadata page");
    assert!(metadata.rows.iter().all(|row| row.payload.is_none()));

    let mut filtered = query(&info.id, true);
    filtered.binding_id = Some("float".to_string());
    let filtered = session
        .history_page(&filtered)
        .await
        .expect("filtered page");
    assert_eq!(filtered.rows.len(), 1);
    assert_eq!(filtered.rows[0].binding_id, "float");

    drop(session);
    remove_database(&path);
}

#[tokio::test]
async fn summaries_counters_and_sql_reads_match_the_written_batches() {
    let (path, mut session, info, batches) = seeded("summaries").await;
    let items: u64 = batches
        .iter()
        .map(|batch| u64::try_from(batch.payload.item_count()).unwrap_or(0))
        .sum();
    let bytes: u64 = batches
        .iter()
        .map(|batch| u64::try_from(batch.payload.effective_bytes()).unwrap_or(0))
        .sum();

    let database = session.database_info().await.expect("database info");
    assert_eq!(database.path, path.to_string_lossy());
    assert!(database.file_size_bytes > 0, "the file holds the schema");
    assert_eq!(database.session_count, 1);
    assert_eq!(database.batch_count, 4);
    assert_eq!(database.item_count, items);
    assert_eq!(database.effective_bytes, bytes);

    let summaries = session.list_session_summaries().await.expect("summaries");
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].session, info);
    assert_eq!(summaries[0].binding_count, 4);
    assert_eq!(summaries[0].batch_count, 4);
    assert_eq!(summaries[0].item_count, items);
    assert_eq!(summaries[0].effective_bytes, bytes);
    assert_eq!(summaries[0].first_timestamp_us, Some(1_000));
    assert_eq!(summaries[0].last_timestamp_us, Some(4_000));
    assert!(
        !summaries[0].active,
        "activity is the hub's concern, not the engine's"
    );

    let cancellation = QueryCancellation::default();
    let sql = session
        .query_sql(
            "SELECT row_id, binding_id, domain, payload FROM recording_batches ORDER BY row_id",
            10,
            &cancellation,
        )
        .await
        .expect("historical SQL");
    assert_eq!(sql.rows.len(), 4);
    assert!(!sql.truncated);
    assert_eq!(sql.rows[0]["row_id"], serde_json::json!(1));
    assert_eq!(sql.rows[0]["domain"], serde_json::json!("bytes"));
    assert_eq!(
        sql.rows[0]["payload"],
        serde_json::json!("<binary:5 bytes>")
    );

    let typed = session
        .query_sql("SELECT 1.5 AS ratio, NULL AS missing", 10, &cancellation)
        .await
        .expect("typed SQL");
    assert_eq!(typed.rows[0]["ratio"], serde_json::json!(1.5));
    assert_eq!(typed.rows[0]["missing"], serde_json::Value::Null);

    let truncated = session
        .query_sql(
            "SELECT row_id FROM recording_batches ORDER BY row_id",
            2,
            &cancellation,
        )
        .await
        .expect("truncated SQL");
    assert_eq!(truncated.rows.len(), 2);
    assert!(
        truncated.truncated,
        "the extra row marks the page truncated"
    );

    for rejected in ["DELETE FROM recording_batches", "SELECT 1; SELECT 2"] {
        let error = session
            .query_sql(rejected, 10, &cancellation)
            .await
            .expect_err("only one bare SELECT/WITH is allowed");
        assert!(matches!(error, RecordingError::Invalid(_)), "{rejected}");
    }

    drop(session);
    remove_database(&path);
}

#[tokio::test]
async fn lifecycle_updates_states_closes_bindings_and_deletes() {
    let (path, mut session, info, _batches) = seeded("lifecycle").await;
    assert!(
        !session
            .session_is_empty(&info.id)
            .await
            .expect("empty probe")
    );

    let bindings = session.list_bindings(&info.id).await.expect("bindings");
    assert_eq!(bindings.len(), 4);
    assert!(bindings.iter().all(|entry| entry.unbound_at_us.is_none()));

    // Re-inserting a binding refreshes it instead of failing.
    let original = &bindings[0];
    let refreshed = DisplayBinding {
        id: original.id.clone(),
        component_id: "component-2".to_string(),
        port: PortIdentity::new(
            original.source_node_id.clone(),
            original.source_handle.clone(),
        ),
        domain: original.domain,
        capability: original.capability,
    };
    session
        .insert_binding(&info.id, &refreshed)
        .await
        .expect("upsert binding");
    let rebound = session.list_bindings(&info.id).await.expect("bindings");
    let rebound = rebound
        .iter()
        .find(|entry| entry.id == refreshed.id)
        .expect("refreshed binding");
    assert_eq!(rebound.component_id, "component-2");

    session
        .close_binding(&info.id, "bytes")
        .await
        .expect("close binding");
    let closed = session.list_bindings(&info.id).await.expect("bindings");
    let closed = closed
        .iter()
        .find(|entry| entry.id == "bytes")
        .expect("closed binding");
    assert!(closed.unbound_at_us.is_some());

    // Pausing keeps the session open; stopping stamps the end.
    session
        .update_session(&info.id, SessionState::Paused)
        .await
        .expect("pause");
    let paused = session.list_sessions().await.expect("sessions");
    assert_eq!(paused[0].state, SessionState::Paused);
    assert!(paused[0].ended_at_us.is_none());

    session
        .update_session(&info.id, SessionState::Stopped)
        .await
        .expect("stop");
    let stopped = session.list_sessions().await.expect("sessions");
    assert_eq!(stopped[0].state, SessionState::Stopped);
    assert!(stopped[0].ended_at_us.is_some());

    // Only a stopped session resumes, and resuming clears the end timestamp.
    let resumed = session
        .reopen_session(&info.id, SessionState::Running)
        .await
        .expect("resume");
    assert_eq!(resumed.state, SessionState::Running);
    assert!(resumed.ended_at_us.is_none());
    assert!(
        session
            .reopen_session(&info.id, SessionState::Running)
            .await
            .is_err(),
        "a running session is not resumable"
    );

    // A session that holds data is never the startup continuation.
    assert_eq!(
        session.resumable_empty_session().await.expect("probe"),
        None
    );

    assert!(
        session.delete_session(&info.id).await.is_err(),
        "an active session cannot be deleted"
    );
    session
        .update_session(&info.id, SessionState::Stopped)
        .await
        .expect("stop");
    session.delete_session(&info.id).await.expect("delete");
    assert!(session.list_sessions().await.expect("sessions").is_empty());
    assert!(
        session.delete_session(&info.id).await.is_err(),
        "a missing session is an error"
    );

    drop(session);
    remove_database(&path);
}

#[tokio::test]
async fn cleanup_deletes_terminal_sessions_idempotently() {
    let (path, mut session, first, _batches) = seeded("cleanup").await;
    let second = session
        .create_session(&[binding("second", Domain::Bytes)])
        .await
        .expect("second session");
    let row_id = session.next_row_id().await.expect("fresh row id");
    assert_eq!(row_id, 5, "row ids are global across sessions");
    let small = record(
        "second",
        0,
        vec![5_000],
        BatchPayload::Bytes {
            data: vec![7, 7, 7],
        },
    );
    session
        .write_batch(&second.id, row_id, &small)
        .await
        .expect("write");
    session
        .update_session(&second.id, SessionState::Stopped)
        .await
        .expect("stop");

    let result = session
        .delete_sessions(&first.id, std::slice::from_ref(&second.id))
        .await
        .expect("cleanup");
    assert_eq!(result.deleted_sessions, 1);
    assert_eq!(result.deleted_batches, 1);
    assert_eq!(result.deleted_items, 3);
    assert_eq!(result.deleted_bytes, 3);
    assert!(result.warning.is_none());

    // Repeating counts the already-gone session again: cleanup is idempotent.
    let repeat = session
        .delete_sessions(&first.id, &[second.id.clone(), second.id.clone()])
        .await
        .expect("repeat cleanup");
    assert_eq!(repeat.deleted_sessions, 1);
    assert_eq!(repeat.deleted_batches, 0);
    assert!(repeat.warning.is_none());

    let ghost = session
        .delete_sessions(&first.id, &["ghost".to_string()])
        .await
        .expect("unknown session");
    assert_eq!(
        ghost.deleted_sessions, 1,
        "an absent session counts as deleted"
    );
    assert!(ghost.warning.is_none());
    assert_eq!(
        session
            .delete_sessions(&first.id, &[])
            .await
            .expect("empty cleanup"),
        crate::RecordingCleanupResult::default()
    );

    assert!(
        session
            .delete_sessions(&second.id, std::slice::from_ref(&second.id))
            .await
            .is_err(),
        "the current session is refused"
    );
    let third = session.create_session(&[]).await.expect("third session");
    assert!(
        session
            .delete_sessions(&first.id, std::slice::from_ref(&third.id))
            .await
            .is_err(),
        "an active session is refused"
    );
    assert!(
        session
            .list_sessions()
            .await
            .expect("sessions")
            .iter()
            .any(|entry| entry.id == third.id),
        "a refused session survives"
    );

    drop(session);
    remove_database(&path);
}

/// `connect` is the writer's path: it opens (creating) without the recovery
/// probe, and the port's `BEGIN`/`COMMIT` pair is what makes an append durable.
#[tokio::test]
async fn write_transactions_commit_only_through_begin_and_commit() {
    let path = database_path("transaction");
    let mut session = SeaOrmEngine
        .connect(&path)
        .await
        .expect("connect through the engine");
    let info = session
        .create_session(&sample_bindings())
        .await
        .expect("create session");
    let batches = sample_batches();

    session.begin().await.expect("begin");
    session
        .write_batch(&info.id, 1, &batches[0])
        .await
        .expect("first batch");
    session
        .write_batch(&info.id, 2, &batches[1])
        .await
        .expect("second batch");
    session.commit().await.expect("commit");

    let page = session
        .history_page(&query(&info.id, true))
        .await
        .expect("page");
    assert_eq!(page.rows.len(), 2, "one commit persists both batches");
    assert!(
        session.commit().await.is_err(),
        "committing without an open transaction is an error"
    );

    drop(session);
    remove_database(&path);
}

#[tokio::test]
async fn the_newest_empty_session_is_the_resume_candidate() {
    let path = database_path("resume");
    let (mut session, _note) = SeaOrmEngine.open(&path).await.expect("open");
    let empty = session
        .create_session(&sample_bindings())
        .await
        .expect("create session");
    assert!(session.session_is_empty(&empty.id).await.expect("probe"));
    assert_eq!(
        session.resumable_empty_session().await.expect("probe"),
        Some(empty.id.clone())
    );
    // The probe normalizes the empty session before offering it.
    let sessions = session.list_sessions().await.expect("sessions");
    assert_eq!(sessions[0].state, SessionState::Stopped);
    let resumed = session
        .reopen_session(&empty.id, SessionState::Running)
        .await
        .expect("resume the candidate");
    assert_eq!(resumed.state, SessionState::Running);

    // Once the session holds a batch it is no longer a continuation candidate.
    let row_id = session.next_row_id().await.expect("row id");
    session
        .write_batch(&empty.id, row_id, &sample_batches()[0])
        .await
        .expect("write batch");
    assert!(!session.session_is_empty(&empty.id).await.expect("probe"));
    assert_eq!(
        session.resumable_empty_session().await.expect("probe"),
        None
    );

    drop(session);
    remove_database(&path);
}

#[tokio::test]
async fn read_only_connections_serve_reads_only() {
    let (path, session, info, _batches) = seeded("read-only").await;
    drop(session);

    let mut reader = SeaOrmEngine
        .connect_read_only(&path)
        .await
        .expect("read-only connection");
    assert_eq!(reader.list_sessions().await.expect("sessions").len(), 1);
    let page = reader
        .history_page(&query(&info.id, false))
        .await
        .expect("page");
    assert_eq!(page.rows.len(), 4);
    assert!(page.rows.iter().all(|row| row.payload.is_none()));
    assert!(
        reader
            .update_session(&info.id, SessionState::Stopped)
            .await
            .is_err(),
        "mode=ro must refuse writes"
    );

    drop(reader);
    remove_database(&path);
}

#[tokio::test]
async fn rebuild_reopens_the_same_file_and_open_closes_orphans() {
    let (path, mut session, info, _batches) = seeded("rebuild").await;
    let rebuilt = session.rebuild().await.expect("rebuild");
    assert_eq!(rebuilt, path, "SQLite rebuilds in place");
    assert_eq!(
        session.next_row_id().await.expect("row id after rebuild"),
        5,
        "the reopened handle still sees the written rows"
    );
    assert!(
        !session.is_recoverable(&RecordingError::Failed("sqlite: disk gone".into())),
        "no SQLite error is healed by a rebuild"
    );
    drop(session);

    // A later open is the crash-recovery path: the session the first process
    // left running is closed while its data stays.
    let (mut reopened, note) = SeaOrmEngine.open(&path).await.expect("reopen");
    assert!(note.is_none());
    let sessions = reopened.list_sessions().await.expect("sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, info.id);
    assert_eq!(sessions[0].state, SessionState::Failed);
    assert!(sessions[0].ended_at_us.is_some());

    drop(reopened);
    remove_database(&path);
}

#[tokio::test]
async fn schema_round_trips_a_session_binding_and_batch() {
    let path = database_path("schema");
    let connection = connect_and_initialize(&sqlite_url(&path))
        .await
        .expect("open and initialize");
    let backend = DbBackend::Sqlite;

    let payload: Vec<u8> = Vec::from([0xAA, 0xBB, 0xCC, 0xDD]);
    connection
        .execute_raw(Statement::from_sql_and_values(
            backend,
            "INSERT INTO recording_sessions(id, started_at_us, state) VALUES (?, ?, ?)",
            [
                SeaValue::from("session-1"),
                SeaValue::from(7_i64),
                SeaValue::from("running"),
            ],
        ))
        .await
        .expect("insert session");
    connection
        .execute_raw(Statement::from_sql_and_values(
            backend,
            "INSERT INTO display_bindings(\
                id, session_id, component_id, source_node_id, source_handle, domain, capability, bound_at_us\
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                SeaValue::from("binding-1"),
                SeaValue::from("session-1"),
                SeaValue::from("component"),
                SeaValue::from("source"),
                SeaValue::from("handle"),
                SeaValue::from("bytes"),
                SeaValue::from("records"),
                SeaValue::from(11_i64),
            ],
        ))
        .await
        .expect("insert binding");
    connection
        .execute_raw(Statement::from_sql_and_values(
            backend,
            "INSERT INTO recording_batches(\
                row_id, session_id, binding_id, domain, epoch, sequence_start, sequence_end, \
                first_timestamp_us, last_timestamp_us, item_count, effective_bytes, checksum, payload, committed_at_us\
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                SeaValue::from(1_i64),
                SeaValue::from("session-1"),
                SeaValue::from("binding-1"),
                SeaValue::from("bytes"),
                SeaValue::from(1_i64),
                SeaValue::from(0_i64),
                SeaValue::from(3_i64),
                SeaValue::from(100_i64),
                SeaValue::from(100_i64),
                SeaValue::from(4_i64),
                SeaValue::from(4_i64),
                SeaValue::from(0_i64),
                SeaValue::from(payload.clone()),
                SeaValue::from(200_i64),
            ],
        ))
        .await
        .expect("insert batch");

    let rows: Vec<QueryResult> = connection
        .query_all_raw(Statement::from_string(
            backend,
            "SELECT b.row_id, b.payload, s.state \
             FROM recording_batches b JOIN recording_sessions s ON s.id = b.session_id",
        ))
        .await
        .expect("join read");
    assert_eq!(rows.len(), 1, "one batch row");
    assert_eq!(rows[0].try_get_by_index::<i64>(0).expect("row_id"), 1);
    assert_eq!(
        rows[0].try_get_by_index::<Vec<u8>>(1).expect("payload"),
        payload
    );
    assert_eq!(
        rows[0].try_get_by_index::<String>(2).expect("state"),
        "running"
    );

    // The upsert path the store relies on must exist on this engine.
    connection
        .execute_raw(Statement::from_sql_and_values(
            backend,
            "INSERT INTO display_bindings(\
                id, session_id, component_id, source_node_id, source_handle, domain, capability, bound_at_us\
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(session_id, id) DO UPDATE SET bound_at_us=excluded.bound_at_us",
            [
                SeaValue::from("binding-1"),
                SeaValue::from("session-1"),
                SeaValue::from("component"),
                SeaValue::from("source"),
                SeaValue::from("handle"),
                SeaValue::from("bytes"),
                SeaValue::from("records"),
                SeaValue::from(99_i64),
            ],
        ))
        .await
        .expect("upsert binding");
    let rebound: i64 = connection
        .query_one_raw(Statement::from_sql_and_values(
            backend,
            "SELECT bound_at_us FROM display_bindings WHERE id = ?",
            [SeaValue::from("binding-1")],
        ))
        .await
        .expect("read binding")
        .expect("binding row")
        .try_get_by_index(0)
        .expect("bound_at_us");
    assert_eq!(rebound, 99);

    drop(connection);
    remove_database(&path);
}
