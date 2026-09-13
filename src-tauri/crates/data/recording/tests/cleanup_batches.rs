use recording::{
    BatchPayload, BindingCapability, DisplayBinding, Domain, PortIdentity, RecordingCleanupPolicy,
    RecordingHub, RecordingLimits, SessionState,
};

fn binding() -> DisplayBinding {
    DisplayBinding {
        id: "bytes".into(),
        component_id: "component".into(),
        port: PortIdentity::new("source", "bytes"),
        domain: Domain::Bytes,
        capability: BindingCapability::Raw,
    }
}

#[test]
fn cleanup_deletes_terminal_sessions_with_batches() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-cleanup-batches-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let hub = RecordingHub::default();
    for index in 0..3_u8 {
        hub.start(
            &path,
            Vec::from([binding()]),
            RecordingLimits::default(),
            SessionState::Running,
        )
        .unwrap();
        hub.record(
            &PortIdentity::new("source", "bytes"),
            1,
            0,
            Vec::from([u64::from(index)]),
            BatchPayload::Bytes {
                data: Vec::from([index]),
            },
        )
        .unwrap();
        hub.flush().unwrap();
        hub.stop().unwrap();
    }
    let current = hub
        .start(
            &path,
            Vec::new(),
            RecordingLimits::default(),
            SessionState::Running,
        )
        .unwrap();
    assert_eq!(hub.list_session_summaries().unwrap().len(), 4);

    let deleted = hub
        .cleanup_sessions(RecordingCleanupPolicy {
            delete_stopped: true,
            ..RecordingCleanupPolicy::default()
        })
        .unwrap();
    assert_eq!(deleted.deleted_sessions, 3);
    assert_eq!(deleted.deleted_batches, 3);
    let summaries = hub.list_session_summaries().unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].session.id, current.id);
    hub.stop().unwrap();
    let _ = std::fs::remove_file(path);
}

#[test]
fn duckdb_foreign_key_delete_behavior() {
    let connection = duckdb::Connection::open_in_memory().unwrap();
    connection
        .execute_batch(
            "CREATE TABLE parent(id VARCHAR PRIMARY KEY); \
             CREATE TABLE child(session_id VARCHAR REFERENCES parent(id)); \
             INSERT INTO parent VALUES ('a'), ('b'), ('c'); \
             INSERT INTO child VALUES ('a'), ('b'), ('c'); \
             DELETE FROM child WHERE session_id IN ('a', 'b', 'c'); \
             DELETE FROM parent WHERE id IN ('a', 'b', 'c');",
        )
        .unwrap();
    let count: i64 = connection
        .query_row("SELECT count(*) FROM parent", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn cleanup_deletes_large_terminal_session_with_batches() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-cleanup-large-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let hub = RecordingHub::default();
    hub.start(
        &path,
        Vec::from([binding()]),
        RecordingLimits::default(),
        SessionState::Running,
    )
    .unwrap();
    let port = PortIdentity::new("source", "bytes");
    for index in 0..2_500_u64 {
        loop {
            match hub.record(
                &port,
                1,
                index,
                Vec::from([index]),
                BatchPayload::Bytes {
                    data: Vec::from([0]),
                },
            ) {
                Ok(_) => break,
                Err(error) => {
                    if error.to_string().contains("queue is full") {
                        std::thread::sleep(std::time::Duration::from_millis(1));
                    } else {
                        panic!("record failed: {error}");
                    }
                }
            }
        }
    }
    hub.flush().unwrap();
    hub.stop().unwrap();
    let _current = hub
        .start(
            &path,
            Vec::new(),
            RecordingLimits::default(),
            SessionState::Running,
        )
        .unwrap();
    let deleted = hub
        .cleanup_sessions(RecordingCleanupPolicy {
            delete_stopped: true,
            ..RecordingCleanupPolicy::default()
        })
        .unwrap();
    assert_eq!(deleted.deleted_sessions, 1);
    assert_eq!(deleted.deleted_batches, 2_500);
    assert_eq!(hub.list_session_summaries().unwrap().len(), 1);
    hub.stop().unwrap();
    let _ = std::fs::remove_file(path);
}
