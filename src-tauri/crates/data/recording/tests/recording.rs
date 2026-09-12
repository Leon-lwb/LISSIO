use recording::{
    BatchPayload, BindingCapability, DisplayBinding, Domain, HistoryQuery, PortIdentity,
    RecordBatch, Recorder, RecordingCleanupPolicy, RecordingExportFormat, RecordingExportRequest,
    RecordingHub, RecordingLimits, RecordingStore, SessionState, export_recording_data,
};

fn binding(id: &str, domain: Domain) -> DisplayBinding {
    DisplayBinding {
        id: id.into(),
        component_id: format!("component-{id}"),
        port: PortIdentity::new("source", id),
        domain,
        capability: BindingCapability::Records,
    }
}

fn batch(id: &str, sequence: u64, payload: BatchPayload) -> RecordBatch {
    let timestamps_us = match &payload {
        BatchPayload::Bytes { .. } | BatchPayload::Spectrum { .. } => vec![sequence + 10],
        BatchPayload::String { values } => (0..values.len())
            .map(|offset| sequence + offset as u64 + 10)
            .collect(),
        BatchPayload::Float { values } => (0..values.len())
            .map(|offset| sequence + offset as u64 + 10)
            .collect(),
    };
    RecordBatch {
        binding_id: id.into(),
        epoch: 2,
        sequence_start: sequence,
        timestamps_us,
        payload,
    }
}

#[test]
fn persists_and_queries_all_domains_without_loss() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-test-{}-{}.duckdb",
        std::process::id(),
        std::thread::current().name().unwrap_or("domains")
    ));
    let _ = std::fs::remove_file(&path);
    let store = RecordingStore::open(&path).unwrap();
    let bindings = vec![
        binding("bytes", Domain::Bytes),
        binding("string", Domain::String),
        binding("float", Domain::Float),
        binding("spectrum", Domain::Spectrum),
    ];
    let recorder = Recorder::start(
        store.clone(),
        bindings,
        RecordingLimits {
            queue_batches: 16,
            transaction_bytes: 1024,
            commit_interval_ms: 20,
        },
    )
    .unwrap();
    let session_id = recorder.session().id.clone();
    let inputs = vec![
        batch(
            "bytes",
            0,
            BatchPayload::Bytes {
                data: vec![0, 1, 255],
            },
        ),
        batch(
            "string",
            3,
            BatchPayload::String {
                values: vec!["same".into(), "same".into(), "变化".into()],
            },
        ),
        batch(
            "float",
            6,
            BatchPayload::Float {
                values: vec![0.0, -2.5, f64::MAX],
            },
        ),
        batch(
            "spectrum",
            9,
            BatchPayload::Spectrum {
                frequencies: vec![0.0, 10.0, 20.0],
                values: vec![1.0, 0.5, 0.25],
            },
        ),
    ];
    for input in &inputs {
        recorder.append(input.clone()).unwrap();
    }
    recorder.flush().unwrap();
    let health = recorder.health();
    assert_eq!(health.accepted_batches, 4);
    assert_eq!(health.accepted_batches, health.persisted_batches);
    assert_eq!(health.accepted_bytes, health.persisted_bytes);

    let page = store.history_page(&session_id, None, 0, 10, true).unwrap();
    assert_eq!(page.rows.len(), 4);
    for (stored, input) in page.rows.iter().zip(&inputs) {
        assert_eq!(stored.payload.as_ref(), Some(&input.payload));
        assert_eq!(stored.sequence_start, input.sequence_start);
        assert_eq!(stored.sequence_end, input.sequence_end());
    }
    let result = store
        .query_sql(
            "SELECT domain, sum(effective_bytes) AS bytes FROM recording_batches GROUP BY domain ORDER BY domain",
            10,
        )
        .unwrap();
    assert_eq!(result.rows.len(), 4);
    assert!(!result.truncated);
    let summaries = store.list_session_summaries().unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].session.id, session_id);
    assert_eq!(summaries[0].binding_count, 4);
    let bindings = store.list_bindings(&session_id).unwrap();
    assert_eq!(bindings.len(), 4);
    let info = store.database_info().unwrap();
    assert_eq!(info.session_count, 1);
    assert_eq!(info.batch_count, 4);
    let filtered = store
        .history_page_query(&HistoryQuery {
            session_id: session_id.clone(),
            binding_id: Some("float".to_string()),
            after_row_id: 0,
            from_us: None,
            to_us: None,
            limit: 10,
            include_payload: true,
        })
        .unwrap();
    assert_eq!(filtered.rows.len(), 1);
    let csv_path = path.with_extension("csv");
    let exported = export_recording_data(
        &store,
        &RecordingExportRequest {
            session_id: session_id.clone(),
            binding_id: None,
            from_us: None,
            to_us: None,
            format: RecordingExportFormat::Csv,
            path: csv_path.to_string_lossy().into_owned(),
        },
    )
    .unwrap();
    assert!(exported.rows > 0);
    let csv_text = std::fs::read_to_string(&csv_path).unwrap();
    assert!(csv_text.contains("float"));
    let _ = std::fs::remove_file(csv_path);
    let json_path = path.with_extension("json");
    let json_export = export_recording_data(
        &store,
        &RecordingExportRequest {
            session_id: session_id.clone(),
            binding_id: Some("float".to_string()),
            from_us: None,
            to_us: None,
            format: RecordingExportFormat::Json,
            path: json_path.to_string_lossy().into_owned(),
        },
    )
    .unwrap();
    assert!(json_export.rows > 0);
    let _ = std::fs::remove_file(json_path);
    let parquet_path = path.with_extension("parquet");
    let parquet_export = export_recording_data(
        &store,
        &RecordingExportRequest {
            session_id: session_id.clone(),
            binding_id: Some("spectrum".to_string()),
            from_us: None,
            to_us: None,
            format: RecordingExportFormat::Parquet,
            path: parquet_path.to_string_lossy().into_owned(),
        },
    )
    .unwrap();
    assert!(parquet_export.rows > 0);
    let _ = std::fs::remove_file(parquet_path);
    recorder.shutdown().unwrap();
    let reopened = RecordingStore::open(&path).unwrap();
    let sessions = reopened.list_sessions().unwrap();
    assert_eq!(sessions[0].state, SessionState::Stopped);
    reopened.delete_session(&session_id).unwrap();
    assert_eq!(reopened.list_sessions().unwrap(), []);
    let _ = std::fs::remove_file(path);
}

#[test]
fn rejects_domain_mismatch_before_acceptance() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-mismatch-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let store = RecordingStore::open(&path).unwrap();
    let recorder = Recorder::start(
        store,
        vec![binding("float", Domain::Float)],
        RecordingLimits::default(),
    )
    .unwrap();
    let error = recorder
        .append(batch(
            "float",
            0,
            BatchPayload::String {
                values: vec!["wrong".into()],
            },
        ))
        .unwrap_err();
    assert!(error.to_string().contains("different domain"));
    assert_eq!(recorder.health().accepted_batches, 0);
    recorder.shutdown().unwrap();
    let _ = std::fs::remove_file(path);
}

#[test]
fn analytical_query_can_be_cancelled() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-cancel-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let hub = recording::RecordingHub::default();
    hub.start(&path, Vec::new(), RecordingLimits::default())
        .unwrap();
    let query_hub = hub.clone();
    let query = std::thread::spawn(move || {
        query_hub.query_sql(
            "cancel-test",
            "SELECT sum(value) FROM range(10000000000) AS values(value)",
            1,
        )
    });
    // DuckDB interruption applies to the currently executing query. Give the
    // spawned worker enough time to register its handle and enter execution.
    std::thread::sleep(std::time::Duration::from_millis(250));
    assert!(hub.cancel_query("cancel-test"));
    assert!(query.join().unwrap().is_err());
    hub.stop().unwrap();
    let _ = std::fs::remove_file(path);
}

#[test]
fn cleanup_prunes_only_terminal_sessions() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-cleanup-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let hub = RecordingHub::default();
    let _first = hub
        .start(&path, Vec::new(), RecordingLimits::default())
        .unwrap();
    hub.stop().unwrap();
    let second = hub
        .start(&path, Vec::new(), RecordingLimits::default())
        .unwrap();
    assert_eq!(hub.list_session_summaries().unwrap().len(), 2);
    let deleted = hub
        .cleanup_sessions(RecordingCleanupPolicy {
            delete_stopped: true,
            ..RecordingCleanupPolicy::default()
        })
        .unwrap();
    assert_eq!(deleted.deleted_sessions, 1);
    let summaries = hub.list_session_summaries().unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].session.id, second.id);
    assert!(hub.delete_session(&second.id).is_err());
    hub.stop().unwrap();
    let _ = std::fs::remove_file(path);
}

#[test]
fn cleanup_keep_latest_prunes_multiple_terminal_sessions() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-keep-latest-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let hub = RecordingHub::default();
    for _ in 0..3 {
        hub.start(&path, Vec::new(), RecordingLimits::default())
            .unwrap();
        hub.stop().unwrap();
    }
    let current = hub
        .start(&path, Vec::new(), RecordingLimits::default())
        .unwrap();
    assert_eq!(hub.list_session_summaries().unwrap().len(), 4);

    let result = hub
        .cleanup_sessions(RecordingCleanupPolicy {
            keep_latest: Some(1),
            ..RecordingCleanupPolicy::default()
        })
        .unwrap();
    assert_eq!(result.deleted_sessions, 2);
    let summaries = hub.list_session_summaries().unwrap();
    assert_eq!(summaries.len(), 2);
    assert_eq!(summaries[0].session.id, current.id);

    let stopped = hub
        .cleanup_sessions(RecordingCleanupPolicy {
            delete_stopped: true,
            ..RecordingCleanupPolicy::default()
        })
        .unwrap();
    assert_eq!(stopped.deleted_sessions, 1);
    assert_eq!(hub.list_session_summaries().unwrap().len(), 1);
    hub.stop().unwrap();
    let _ = std::fs::remove_file(path);
}

#[test]
fn create_session_while_paused_starts_a_fresh_write_target() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-create-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let hub = RecordingHub::default();
    let first = hub
        .start(
            &path,
            vec![binding("float", Domain::Float)],
            RecordingLimits::default(),
        )
        .unwrap();
    assert!(
        hub.record(
            &PortIdentity::new("source", "float"),
            2,
            0,
            vec![10, 11],
            BatchPayload::Float {
                values: vec![1.0, 2.0],
            },
        )
        .unwrap()
    );
    hub.set_state(SessionState::Paused).unwrap();

    let second = hub.create_session(SessionState::Paused).unwrap();
    let summaries = hub.list_session_summaries().unwrap();
    assert_eq!(summaries.len(), 2);
    let first_summary = summaries
        .iter()
        .find(|summary| summary.session.id == first.id)
        .unwrap();
    let second_summary = summaries
        .iter()
        .find(|summary| summary.session.id == second.id)
        .unwrap();
    assert_eq!(first_summary.session.state, SessionState::Stopped);
    assert!(!first_summary.active);
    assert_eq!(second_summary.session.state, SessionState::Paused);
    assert!(second_summary.active);

    // 后续数据进入新会话,旧会话数据保持完整可查
    assert!(
        hub.record(
            &PortIdentity::new("source", "float"),
            3,
            100,
            vec![200, 201],
            BatchPayload::Float {
                values: vec![3.0, 4.0],
            },
        )
        .unwrap()
    );
    hub.flush().unwrap();
    let store = hub.store().unwrap();
    assert_eq!(
        store
            .history_page(&first.id, None, 0, 10, false)
            .unwrap()
            .rows
            .len(),
        1
    );
    assert_eq!(
        store
            .history_page(&second.id, None, 0, 10, false)
            .unwrap()
            .rows
            .len(),
        1
    );
    hub.stop().unwrap();
    let _ = std::fs::remove_file(path);
}

#[test]
fn switch_session_resumes_a_stopped_session() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-switch-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let hub = RecordingHub::default();
    let first = hub
        .start(
            &path,
            vec![binding("float", Domain::Float)],
            RecordingLimits::default(),
        )
        .unwrap();
    assert!(
        hub.record(
            &PortIdentity::new("source", "float"),
            2,
            0,
            vec![10],
            BatchPayload::Float { values: vec![1.0] },
        )
        .unwrap()
    );
    hub.set_state(SessionState::Paused).unwrap();
    hub.create_session(SessionState::Paused).unwrap();

    let resumed = hub.switch_session(&first.id, SessionState::Paused).unwrap();
    assert_eq!(resumed.id, first.id);
    let summaries = hub.list_session_summaries().unwrap();
    let first_summary = summaries
        .iter()
        .find(|summary| summary.session.id == first.id)
        .unwrap();
    assert_eq!(first_summary.session.state, SessionState::Paused);
    assert!(first_summary.active);
    assert!(
        summaries
            .iter()
            .filter(|summary| summary.session.id != first.id)
            .all(|summary| summary.session.state == SessionState::Stopped && !summary.active)
    );

    // 目标校验:当前写入会话与不存在的会话都拒绝
    assert!(hub.switch_session(&first.id, SessionState::Paused).is_err());
    assert!(
        hub.switch_session("missing-session", SessionState::Paused)
            .is_err()
    );

    // 恢复后继续写入原会话
    assert!(
        hub.record(
            &PortIdentity::new("source", "float"),
            3,
            100,
            vec![200],
            BatchPayload::Float { values: vec![3.0] },
        )
        .unwrap()
    );
    hub.flush().unwrap();
    let store = hub.store().unwrap();
    assert_eq!(
        store
            .history_page(&first.id, None, 0, 10, false)
            .unwrap()
            .rows
            .len(),
        2
    );
    hub.stop().unwrap();
    let _ = std::fs::remove_file(path);
}

#[test]
fn session_operations_require_a_started_hub() {
    let hub = RecordingHub::default();
    assert!(hub.create_session(SessionState::Paused).is_err());
    assert!(
        hub.switch_session("anything", SessionState::Paused)
            .is_err()
    );
}
