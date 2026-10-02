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

/// 回归: 清理必须**先摘掉时间索引**再删批次, 结束后按剩余行重建。
///
/// 真实库里撞到的 FATAL 正是「带索引删批次」撞上索引与表不一致 —— 索引缺了一整段
/// 已提交的行, DuckDB 把索引删除失败升级成致命错误并让整个 DatabaseInstance 失效,
/// 之后连兜底的 DROP INDEX 都跑不了。
#[test]
fn cleanup_detaches_and_rebuilds_the_time_index() {
    fn time_index_count(connection: &duckdb::Connection) -> i64 {
        connection
            .query_row(
                "SELECT count(*) FROM duckdb_indexes() WHERE index_name = 'recording_time_idx'",
                [],
                |row| row.get(0),
            )
            .unwrap()
    }

    let path = std::env::temp_dir().join(format!(
        "lissio-recording-cleanup-index-{}.duckdb",
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
    for index in 0..1_500_u64 {
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

    // 先录完检查索引还在; 这个临时连接必须关掉, 免得和 hub 的实例抢同一个文件。
    let connection = duckdb::Connection::open(&path).unwrap();
    assert_eq!(time_index_count(&connection), 1, "录完之后索引必须在");
    drop(connection);

    // 用当前会话占住 writer, 再清掉刚停下的那个会话。
    hub.start(
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
    assert_eq!(deleted.deleted_batches, 1_500);
    assert!(
        deleted.warning.is_none(),
        "清理不该把失败吞成警告: {:?}",
        deleted.warning
    );
    hub.stop().unwrap();

    let connection = duckdb::Connection::open(&path).unwrap();
    assert_eq!(
        time_index_count(&connection),
        1,
        "清理结束后索引必须按剩余行重建"
    );
    let rows: i64 = connection
        .query_row("SELECT count(*) FROM recording_batches", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(rows, 0, "被删会话的批次必须真的删掉");
    drop(connection);
    let _ = std::fs::remove_file(path);
}
