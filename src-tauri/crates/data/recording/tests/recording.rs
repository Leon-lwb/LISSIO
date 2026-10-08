use recording::{
    BatchPayload, BindingCapability, DisplayBinding, Domain, HistoryQuery, PortIdentity,
    RecordBatch, Recorder, RecordingCleanupPolicy, RecordingError, RecordingExportFormat,
    RecordingExportRequest, RecordingHub, RecordingLimits, RecordingStore, SessionState,
    export_recording_data,
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
fn unavailable_database_is_reported_but_is_not_a_writer_fault() {
    // 采集门控回归: 数据库打不开 (Windows 上另一实例持有强制文件锁) 曾是
    // `fault`, 于是读任务每批字节后都把工作区停回 Stopped — 用户每点一次
    // "开始" 只有几字节进收集器。契约: 没有 writer 就没有可违反的写入契约。
    let base = std::env::temp_dir().join(format!(
        "lissio-recording-unavailable-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).unwrap();
    // 父路径是普通文件 → 建库/打开必然失败 (跨平台确定)
    let blocker = base.join("not-a-directory");
    std::fs::write(&blocker, b"blocker").unwrap();
    let path = blocker.join("acquisition.duckdb");

    let hub = RecordingHub::default();
    let bindings = vec![binding("float", Domain::Float)];
    let limits = RecordingLimits::default();
    let outcome = hub.start(&path, bindings, limits, SessionState::Paused);
    assert!(outcome.is_err());

    assert!(
        hub.fault().is_none(),
        "录制不可用不得算作写入故障: {:?}",
        hub.fault()
    );
    assert!(
        hub.health().failed.is_some(),
        "录制不可用必须保持可见 (健康报告)"
    );

    // 没有 recorder 时 hub 是惰性的: 生产者照常运行, 运行态切换不报错
    let port = PortIdentity::new("source", "float");
    let payload = BatchPayload::Float { values: vec![1.0] };
    assert!(!hub.record(&port, 2, 0, vec![10], payload).unwrap());
    hub.set_state(SessionState::Running).unwrap();
    hub.stop().unwrap();

    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn analytical_query_can_be_cancelled() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-cancel-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let hub = recording::RecordingHub::default();
    hub.start(
        &path,
        Vec::new(),
        RecordingLimits::default(),
        SessionState::Running,
    )
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
    // 第一个会话写入数据, 这样第二次 start 才会新建会话 (空会话会被续写)
    let _first = hub
        .start(
            &path,
            Vec::from([binding("float", Domain::Float)]),
            RecordingLimits::default(),
            SessionState::Running,
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
    hub.flush().unwrap();
    hub.stop().unwrap();
    let second = hub
        .start(
            &path,
            Vec::new(),
            RecordingLimits::default(),
            SessionState::Running,
        )
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
    for index in 0..3_u8 {
        hub.start(
            &path,
            Vec::from([binding("float", Domain::Float)]),
            RecordingLimits::default(),
            SessionState::Running,
        )
        .unwrap();
        assert!(
            hub.record(
                &PortIdentity::new("source", "float"),
                2,
                0,
                vec![10],
                BatchPayload::Float {
                    values: vec![f64::from(index)],
                },
            )
            .unwrap()
        );
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
            SessionState::Running,
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
            SessionState::Running,
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

#[test]
fn start_continues_the_last_session_while_it_stays_empty() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-continue-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let hub = RecordingHub::default();
    let first = hub
        .start(
            &path,
            Vec::new(),
            RecordingLimits::default(),
            SessionState::Paused,
        )
        .unwrap();
    hub.stop().unwrap();

    // 上次会话没有写入任何批次: 继续写同一会话并以 paused 开局, 不新增空会话
    let second = hub
        .start(
            &path,
            Vec::new(),
            RecordingLimits::default(),
            SessionState::Paused,
        )
        .unwrap();
    assert_eq!(second.id, first.id);
    let summaries = hub.list_session_summaries().unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].session.id, first.id);
    assert_eq!(summaries[0].session.state, SessionState::Paused);
    assert!(summaries[0].active);
    hub.stop().unwrap();
    let _ = std::fs::remove_file(path);
}

#[test]
fn start_resumes_an_empty_session_left_by_a_crash() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-crash-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let hub = RecordingHub::default();
    let first = hub
        .start(
            &path,
            Vec::new(),
            RecordingLimits::default(),
            SessionState::Running,
        )
        .unwrap();
    hub.stop().unwrap();

    // 模拟崩溃遗留: 把空会话改回 running, 下次 RecordingStore::open 的孤儿
    // 清理会把它标为 failed — 空会话仍应被续用
    {
        let connection = duckdb::Connection::open(&path).unwrap();
        connection
            .execute("UPDATE recording_sessions SET state='running'", [])
            .unwrap();
    }

    let resumed = hub
        .start(
            &path,
            Vec::new(),
            RecordingLimits::default(),
            SessionState::Paused,
        )
        .unwrap();
    assert_eq!(resumed.id, first.id);
    let summaries = hub.list_session_summaries().unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].session.state, SessionState::Paused);
    hub.stop().unwrap();
    let _ = std::fs::remove_file(path);
}

#[test]
fn start_creates_a_new_session_once_the_last_holds_data() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-new-after-data-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let hub = RecordingHub::default();
    let first = hub
        .start(
            &path,
            vec![binding("float", Domain::Float)],
            RecordingLimits::default(),
            SessionState::Running,
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
    hub.flush().unwrap();
    hub.stop().unwrap();

    // 上次会话有数据: 新建会话, 旧数据保持可查
    let second = hub
        .start(
            &path,
            Vec::new(),
            RecordingLimits::default(),
            SessionState::Paused,
        )
        .unwrap();
    assert_ne!(second.id, first.id);
    let summaries = hub.list_session_summaries().unwrap();
    assert_eq!(summaries.len(), 2);
    let first_summary = summaries
        .iter()
        .find(|summary| summary.session.id == first.id)
        .unwrap();
    assert_eq!(first_summary.session.state, SessionState::Stopped);
    let second_summary = summaries
        .iter()
        .find(|summary| summary.session.id == second.id)
        .unwrap();
    assert_eq!(second_summary.session.state, SessionState::Paused);
    assert!(second_summary.active);
    hub.stop().unwrap();
    let _ = std::fs::remove_file(path);
}

#[test]
fn apply_settings_moves_the_database_and_keeps_the_old_file() {
    let base =
        std::env::temp_dir().join(format!("lissio-recording-relocate-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let first_path = base.join("a").join("acquisition.duckdb");
    let second_path = base.join("b").join("acquisition.duckdb");
    let hub = RecordingHub::default();
    let first = hub
        .start(
            &first_path,
            vec![binding("float", Domain::Float)],
            RecordingLimits::default(),
            SessionState::Running,
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
    hub.flush().unwrap();

    let swapped = hub
        .apply_settings(Some(second_path.clone()), true, SessionState::Paused)
        .unwrap();
    assert!(swapped);

    // 旧文件原地保留, 旧会话可查 (replace 时已标记 stopped)
    assert!(first_path.exists());
    let old_store = RecordingStore::open(&first_path).unwrap();
    let old_sessions = old_store.list_sessions().unwrap();
    assert_eq!(old_sessions.len(), 1);
    assert_eq!(old_sessions[0].id, first.id);
    assert_eq!(old_sessions[0].state, SessionState::Stopped);

    // 新位置: 空库 → 新建会话 (paused 开局), 后续写入进入新文件
    let summaries = hub.list_session_summaries().unwrap();
    assert_eq!(summaries.len(), 1);
    assert_ne!(summaries[0].session.id, first.id);
    assert_eq!(summaries[0].session.state, SessionState::Paused);
    assert!(
        hub.record(
            &PortIdentity::new("source", "float"),
            3,
            0,
            vec![20],
            BatchPayload::Float { values: vec![2.0] },
        )
        .unwrap()
    );
    hub.flush().unwrap();
    let info = hub.database_info().unwrap();
    assert_eq!(info.path, second_path.to_string_lossy());
    assert_eq!(info.batch_count, 1);
    hub.stop().unwrap();
    let _ = std::fs::remove_dir_all(base);
}

#[test]
fn apply_settings_without_continuation_abandons_an_empty_session() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-no-continue-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let hub = RecordingHub::default();
    let first = hub
        .start(
            &path,
            Vec::new(),
            RecordingLimits::default(),
            SessionState::Paused,
        )
        .unwrap();

    // 续写关闭 + 当前会话仍为空: 换成全新会话, 恢复"每次启动一会话"
    let swapped = hub
        .apply_settings(Some(path.clone()), false, SessionState::Paused)
        .unwrap();
    assert!(swapped);
    let summaries = hub.list_session_summaries().unwrap();
    let current = summaries
        .iter()
        .find(|summary| summary.active)
        .unwrap()
        .session
        .id
        .clone();
    assert_ne!(current, first.id);
    let first_summary = summaries
        .iter()
        .find(|summary| summary.session.id == first.id)
        .unwrap();
    assert_eq!(first_summary.session.state, SessionState::Stopped);
    hub.stop().unwrap();
    let _ = std::fs::remove_file(path);
}

#[test]
fn apply_settings_is_a_noop_when_preferences_match() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-noop-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let hub = RecordingHub::default();
    hub.start(
        &path,
        vec![binding("float", Domain::Float)],
        RecordingLimits::default(),
        SessionState::Running,
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
    hub.flush().unwrap();
    let summaries = hub.list_session_summaries().unwrap();
    let active_id = summaries
        .iter()
        .find(|summary| summary.active)
        .unwrap()
        .session
        .id
        .clone();

    // 同路径: 续写开启无操作; 关闭但会话已有数据 (续写本来就不会命中) 也无操作
    assert!(
        !hub.apply_settings(Some(path.clone()), true, SessionState::Paused)
            .unwrap()
    );
    assert!(
        !hub.apply_settings(Some(path.clone()), false, SessionState::Paused)
            .unwrap()
    );
    let summaries = hub.list_session_summaries().unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].session.id, active_id);
    hub.stop().unwrap();
    let _ = std::fs::remove_file(path);
}

/// 回归 (Windows 「点开始只出几个字符、暂停也解不开」):
/// 写线程队列打满是**正常背压**, 不是写入故障。
///
/// 曾经的链路: `append` 返回 `Backpressure` → `hub` 置 `fault` → 运行控制每个
/// 评估批次后读 [`RecordingHub::fault`] 并把工作区停回 Stopped; 而 `fault`
/// 只在换 recorder 时清除, 于是之后每次「开始」都在一批数据内被打回。
#[test]
fn backpressure_drops_batches_without_becoming_a_sticky_fault() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-backpressure-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let hub = RecordingHub::default();
    // 队列只有一格 + 每批都提交: 紧凑循环必然撞上背压。
    let limits = RecordingLimits {
        queue_batches: 1,
        transaction_bytes: 1,
        commit_interval_ms: 1,
    };
    hub.start(
        &path,
        vec![binding("bytes", Domain::Bytes)],
        limits,
        SessionState::Running,
    )
    .unwrap();
    let port = PortIdentity::new("source", "bytes");

    let mut dropped = 0_u64;
    for index in 0..4_000_u64 {
        match hub.record(
            &port,
            2,
            index,
            vec![index],
            BatchPayload::Bytes {
                data: vec![0_u8; 256 * 1024],
            },
        ) {
            // 背压丢弃: 对生产者不是错误, 更不是故障。
            Ok(false) => dropped += 1,
            Ok(true) => {}
            Err(error) => panic!("背压不得冒泡成错误: {error}"),
        }
        assert!(
            hub.fault().is_none(),
            "队列打满不得置故障 (第 {index} 批): {:?}",
            hub.fault()
        );
    }

    assert!(dropped > 0, "本测试需要真的撞上背压, 否则没有验证力");
    let health = hub.health();
    assert_eq!(health.dropped_batches, dropped, "丢弃批次必须计数");
    assert!(
        health.failed.is_none(),
        "背压不得出现在健康报告的 failed 里: {:?}",
        health.failed
    );

    // 背压是瞬态的: 停写之后必须重新接受批次, 不需要重启会话。
    hub.flush().unwrap();
    let mut accepted = false;
    for index in 0..4_000_u64 {
        if hub
            .record(
                &port,
                2,
                index,
                vec![index],
                BatchPayload::Bytes {
                    data: vec![0_u8; 1024],
                },
            )
            .unwrap()
        {
            accepted = true;
            break;
        }
    }
    assert!(accepted, "背压过后必须能继续录制");
    assert!(hub.fault().is_none());

    hub.stop().unwrap();
    let _ = std::fs::remove_file(path);
}

/// 两个实例同时写同一个 DuckDB 文件会各自 checkpoint 并互相覆盖, 静默抹掉已
/// 提交写入 — 后启动的实例必须退化为「录制不可用」, 既不损坏数据库, 也不能
/// 挡住采集。
#[test]
fn a_second_instance_cannot_open_a_database_another_instance_holds() {
    let path = std::env::temp_dir().join(format!(
        "lissio-recording-instance-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let bindings = || vec![binding("float", Domain::Float)];

    let first = RecordingHub::default();
    first
        .start(
            &path,
            bindings(),
            RecordingLimits::default(),
            SessionState::Paused,
        )
        .unwrap();

    let second = RecordingHub::default();
    let outcome = second.start(
        &path,
        bindings(),
        RecordingLimits::default(),
        SessionState::Paused,
    );
    assert!(outcome.is_err(), "第二个实例不得同时打开同一个数据库文件");
    assert!(
        second.fault().is_none(),
        "数据库被别的实例占住不是写入故障 (会停采集): {:?}",
        second.fault()
    );
    assert!(
        second.health().failed.is_some(),
        "「没有录制」必须对用户可见"
    );
    assert!(second.store().is_none());
    assert!(!second.is_bound(&PortIdentity::new("source", "float")));

    // 第一个实例退出后, 守卫与文件句柄一并释放, 第二个可以接管。
    first.stop().unwrap();
    second
        .start(
            &path,
            bindings(),
            RecordingLimits::default(),
            SessionState::Paused,
        )
        .expect("前一个实例关闭后必须能接管");
    second.stop().unwrap();

    let _ = std::fs::remove_file(path.with_extension("duckdb.lock"));
    let _ = std::fs::remove_file(path);
}

/// 打开必须**有界且不阻塞**: Windows 上别的进程持有强制锁时
/// `Connection::open` 会一直等下去, 而调用方往往正持着数据链边界锁。
///
/// 这里用同进程内的另一个句柄占住数据库文件 (与跨进程一样的强制锁语义),
/// 断言启动在探测重试窗口内失败、归「录制不可用」而不是故障, 采集不受影响。
#[test]
fn opening_a_locked_database_fails_fast_instead_of_blocking() {
    use std::fs::OpenOptions;

    let path = std::env::temp_dir().join(format!(
        "lissio-recording-locked-{}.duckdb",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("duckdb.lock"));
    std::fs::write(&path, b"").unwrap();

    let holder = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .unwrap();
    holder.try_lock().expect("测试需要先占住数据库文件");

    let hub = RecordingHub::default();
    let started = std::time::Instant::now();
    let outcome = hub.start(
        &path,
        vec![binding("bytes", Domain::Bytes)],
        RecordingLimits::default(),
        SessionState::Paused,
    );
    let elapsed = started.elapsed();

    assert!(outcome.is_err(), "被强制锁占住的库不得被当成可用");
    assert!(
        elapsed < std::time::Duration::from_secs(5),
        "打开必须有界 (探测 + 重试窗口), 实际等待 {elapsed:?}"
    );
    assert!(
        hub.fault().is_none(),
        "打不开是「没有录制」而不是写入故障: {:?}",
        hub.fault()
    );
    assert!(hub.health().failed.is_some(), "「没有录制」必须对用户可见");
    assert!(hub.store().is_none());

    drop(holder);
    let _ = std::fs::remove_file(path.with_extension("duckdb.lock"));
    let _ = std::fs::remove_file(&path);
}

/// 回归: 一个**打不开**的库文件必须在启动时被隔离并新建空库继续录制。
///
/// 修复前这条路径让录制永久不可用, 而用户看到的只是一句
/// 「recording writer is closed」—— 既真实又不可行动, 真实原因只剩在健康报告里。
#[test]
fn an_unreadable_database_is_quarantined_and_recording_continues() {
    let directory = std::env::temp_dir().join(format!(
        "lissio-recording-quarantine-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("acquisition.duckdb");
    // 垃圾内容 = DuckDB 打不开的文件 (实测: "not a valid DuckDB database file")。
    let garbage = vec![0xAB_u8; 8192];
    std::fs::write(&path, &garbage).unwrap();

    let hub = RecordingHub::default();
    hub.start(
        &path,
        Vec::new(),
        RecordingLimits::default(),
        SessionState::Paused,
    )
    .expect("打不开的库必须被隔离并新建空库, 而不是让录制一直不可用");

    // 录制真的恢复了。
    let summaries = hub.list_session_summaries().expect("新库必须可读");
    assert_eq!(summaries.len(), 1, "新库应当正好有一个会话");
    // 原件被原样保留, 并留下可见提示。
    let note = hub.health().warning.expect("隔离必须留下用户可见的提示");
    assert!(note.contains("could not be read"), "{note}");
    let backups: Vec<String> = std::fs::read_dir(&directory)
        .unwrap()
        .filter_map(std::result::Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains(".corrupt-"))
        .collect();
    assert_eq!(backups.len(), 1, "隔离件应当只有一个: {backups:?}");
    assert_eq!(
        std::fs::read(directory.join(&backups[0])).unwrap(),
        garbage,
        "隔离必须逐字节保留原文件"
    );
    assert!(note.contains(&backups[0]), "提示必须指出现件在哪: {note}");

    let _ = hub.stop();
    let _ = std::fs::remove_dir_all(&directory);
}

/// 回归: 录制不可用时, 读路径必须给出**真实原因**。
///
/// 统一退化成 [`RecordingError::Closed`] 会让用户看到
/// 「recording writer is closed」, 而文件不可写 / 开关关掉这些可行动的信息全被吞掉。
#[test]
fn unavailable_reads_report_the_real_reason() {
    let directory =
        std::env::temp_dir().join(format!("lissio-recording-reason-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&directory);
    std::fs::create_dir_all(&directory).unwrap();

    // 用目录占住库文件路径: 探测可写性必然失败 → 「录制不可用」。
    let blocked = directory.join("blocked.duckdb");
    std::fs::create_dir_all(&blocked).unwrap();
    let hub = RecordingHub::default();
    assert!(
        hub.start(
            &blocked,
            Vec::new(),
            RecordingLimits::default(),
            SessionState::Paused
        )
        .is_err(),
        "库文件不可写时应当报「录制不可用」"
    );
    let error = hub.list_session_summaries().unwrap_err();
    let RecordingError::Unavailable(reason) = error else {
        panic!("读路径必须报真实原因, 而不是 {error:?}");
    };
    assert!(reason.contains("not writable"), "{reason}");

    // 总开关关掉是另一种明确状态, 同样不得退化成 Closed。
    hub.disable_at(directory.join("off.duckdb"), RecordingLimits::default());
    let error = hub.list_session_summaries().unwrap_err();
    let RecordingError::Unavailable(reason) = error else {
        panic!("关闭状态必须有自己的原因, 而不是 {error:?}");
    };
    assert!(reason.contains("turned off"), "{reason}");

    let _ = std::fs::remove_dir_all(&directory);
}
