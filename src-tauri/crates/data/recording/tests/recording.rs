use recording::{
    BatchPayload, BindingCapability, DisplayBinding, Domain, PortIdentity, RecordBatch, Recorder,
    RecordingLimits, RecordingStore, SessionState,
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
    recorder.shutdown().unwrap();
    let reopened = RecordingStore::open(&path).unwrap();
    let sessions = reopened.list_sessions().unwrap();
    assert_eq!(sessions[0].state, SessionState::Stopped);
    reopened.delete_session(&session_id).unwrap();
    assert!(reopened.list_sessions().unwrap().is_empty());
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
