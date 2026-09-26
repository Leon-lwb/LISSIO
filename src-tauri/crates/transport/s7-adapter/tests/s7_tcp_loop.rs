use acquisition::{AcquisitionRuntime, DriverContext, SourceFactory, SubscriptionIntent};
use data_model::device::DriverPayload;
use data_model::device_tree::{DriverId, NodeDecl, NodeId};
use device_tree::{DeviceTreeAcquisition, DriverRegistry};
use flow::SourceId;
use points::{
    AcquisitionIntent, AcquisitionMode, DeliveryClass, PointId, PointValue, Priority, ReadRequest,
    WriteItem, WriteRequest,
};
use s7_adapter::{DRIVER_ID, ReconnectConfig, S7Area, S7Config, S7DataType, S7Factory, S7Point};
use s7_mock::{
    AREA_DB, AREA_INPUTS, AREA_MARKERS, AREA_OUTPUTS, MockServer, ReconnectingMockServer,
    spawn_silent_server,
};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;

mod s7_mock;

fn runtime_node(id: &str, label: &str, driver: &str, payload: DriverPayload) -> NodeDecl {
    let mut node =
        NodeDecl::leaf(id, label, driver, payload.schema_version, payload.payload).unwrap();
    node.capability_endpoint_id = Some("client".into());
    node
}

fn point(
    id: &str,
    area: S7Area,
    db_number: u16,
    byte_offset: u32,
    data_type: S7DataType,
) -> S7Point {
    S7Point {
        id: PointId(id.into()),
        area,
        db_number,
        byte_offset,
        bit: 0,
        data_type,
        scale: 1.0,
        offset: 0.0,
        poll_period_ms: 20,
    }
}

fn driver_payload(port: u16, points: Vec<S7Point>) -> DriverPayload {
    let config = S7Config {
        host: "127.0.0.1".into(),
        port,
        plc_type: s7_adapter::S7PlcType::S1200,
        rack: 0,
        slot: 1,
        timeout_ms: 500,
        reconnect: ReconnectConfig {
            max_attempts: 2,
            initial_delay_ms: 1,
            max_delay_ms: 5,
        },
        points,
    };
    DriverPayload {
        driver_id: DriverId(DRIVER_ID.into()),
        schema_version: s7_adapter::SCHEMA_VERSION,
        payload: serde_json::to_value(config).unwrap(),
    }
}

async fn open_session(port: u16, points: Vec<S7Point>) -> Box<dyn acquisition::SourceSession> {
    let factory = S7Factory::default();
    let validated = factory.validate(&driver_payload(port, points)).unwrap();
    let (state_sink, _) = mpsc::channel(8);
    let (event_sink, _) = mpsc::channel(8);
    factory
        .open(
            validated,
            DriverContext {
                connection_epoch: 1,
                source_id: SourceId::new("s7").unwrap(),
                state_sink,
                event_sink,
                execution: acquisition::ExecutionGate::new(
                    acquisition::AcquisitionRunState::Running,
                ),
            },
        )
        .await
        .unwrap()
}

async fn standard_points() -> Vec<S7Point> {
    let mut points = vec![
        point("db_u16", S7Area::Db, 10, 0, S7DataType::U16),
        point("db_f32", S7Area::Db, 10, 2, S7DataType::F32),
        point("marker_bool", S7Area::Markers, 0, 1, S7DataType::Bool),
        point("marker_u16", S7Area::Markers, 0, 10, S7DataType::U16),
        point("input_byte", S7Area::Inputs, 0, 0, S7DataType::U8),
        point("output_byte", S7Area::Outputs, 0, 0, S7DataType::U8),
    ];
    points[2].bit = 3;
    points
}

#[tokio::test]
async fn reads_all_areas_merges_windows_and_writes_back() {
    let mock = MockServer::spawn().await;
    // DB10: u16 0x1234 at 0, f32 1.0 at 2. Markers: byte 1 = 0b1011_0111
    // (bit 3 clear), u16 0x4321 at 10. Inputs: byte 0 = 0x01. Outputs: 0x02.
    mock.poke(AREA_DB, 10, 0, &[0x12, 0x34]).await;
    mock.poke(AREA_DB, 10, 2, &[0x3F, 0x80, 0x00, 0x00]).await;
    mock.poke(AREA_MARKERS, 0, 1, &[0b1011_0111]).await;
    mock.poke(AREA_MARKERS, 0, 10, &[0x43, 0x21]).await;
    mock.poke(AREA_INPUTS, 0, 0, &[0x01]).await;
    mock.poke(AREA_OUTPUTS, 0, 0, &[0x02]).await;

    let session = open_session(mock.port, standard_points().await).await;
    acquisition::validate_capability_contract(session.as_ref()).unwrap();
    let read = session
        .reader()
        .unwrap()
        .read(ReadRequest {
            points: [
                "db_u16",
                "db_f32",
                "marker_bool",
                "marker_u16",
                "input_byte",
                "output_byte",
            ]
            .into_iter()
            .map(|id| PointId(id.into()))
            .collect(),
        })
        .await
        .unwrap();
    let values: Vec<_> = read
        .batch
        .payload
        .samples
        .iter()
        .map(|sample| sample.value.clone())
        .collect();
    assert_eq!(
        values,
        vec![
            Some(PointValue::U64(0x1234)),
            Some(PointValue::F64(1.0)),
            Some(PointValue::Bool(false)),
            Some(PointValue::U64(0x4321)),
            Some(PointValue::U64(1)),
            Some(PointValue::U64(2)),
        ]
    );

    let deadline = now_unix_ns() + 1_000_000_000;
    let write = session
        .writer()
        .unwrap()
        .write(WriteRequest {
            correlation_id: "command-1".into(),
            deadline_unix_ns: deadline,
            idempotency_key: None,
            items: vec![
                WriteItem {
                    point_id: PointId("db_f32".into()),
                    value: PointValue::F64(2.0),
                },
                WriteItem {
                    point_id: PointId("marker_bool".into()),
                    value: PointValue::Bool(true),
                },
            ],
        })
        .await
        .unwrap();
    assert!(
        write
            .items
            .iter()
            .all(|item| item.quality.validity == points::Validity::Good)
    );

    // The bit write must preserve neighbouring bits of the marker byte.
    assert_eq!(mock.peek(AREA_MARKERS, 0, 1, 1).await, vec![0b1011_1111]);
    assert_eq!(
        mock.peek(AREA_DB, 10, 2, 4).await,
        vec![0x40, 0x00, 0x00, 0x00]
    );

    let records = mock.records().await;
    assert!(
        records
            .iter()
            .any(|item| item.function == 0x04 && item.area == AREA_DB && item.count == 6),
        "db window reads are merged: {records:?}"
    );
    assert!(records.iter().any(|item| item.function == 0x05));
    session.close().await.unwrap();
}

#[tokio::test]
async fn invalid_address_return_code_is_a_bad_sample_with_native_status() {
    let mock = MockServer::spawn().await;
    let points = vec![point("far", S7Area::Markers, 0, 4_095, S7DataType::U32)];
    let session = open_session(mock.port, points).await;
    let read = session
        .reader()
        .unwrap()
        .read(ReadRequest {
            points: vec![PointId("far".into())],
        })
        .await
        .unwrap();
    let sample = &read.batch.payload.samples[0];
    assert!(sample.value.is_none());
    assert_eq!(sample.quality.validity, points::Validity::Bad);
    assert_eq!(
        sample.quality.native.as_ref().unwrap().code,
        "returnCode:0x05"
    );
    session.close().await.unwrap();
}

#[tokio::test]
async fn polling_subscription_delivers_typed_batches() {
    let mock = MockServer::spawn().await;
    mock.poke(AREA_DB, 10, 0, &[0x12, 0x34]).await;
    let session = open_session(mock.port, standard_points().await).await;
    let (sink, mut receiver) = mpsc::channel(1);
    let effective = session
        .subscriber()
        .unwrap()
        .subscribe(
            SubscriptionIntent {
                points: vec![PointId("db_u16".into())],
                acquisition: AcquisitionIntent {
                    mode: AcquisitionMode::Poll,
                    requested_period_ms: Some(10),
                    deadband: None,
                    priority: Priority::Normal,
                    delivery: DeliveryClass::State,
                },
            },
            sink,
        )
        .await
        .unwrap();
    assert_eq!(effective.effective_period_ms, Some(10));
    let batch = tokio::time::timeout(Duration::from_secs(1), receiver.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        batch.payload.samples[0].value,
        Some(PointValue::U64(0x1234))
    );
    session.close().await.unwrap();
}

#[tokio::test]
async fn polling_obeys_pause_resume_and_stop_epochs() {
    let mock = MockServer::spawn().await;
    mock.poke(AREA_DB, 10, 0, &[0x12, 0x34]).await;
    let factory = S7Factory::default();
    let validated = factory
        .validate(&driver_payload(mock.port, standard_points().await))
        .unwrap();
    let (state_sink, _) = mpsc::channel(8);
    let (event_sink, _) = mpsc::channel(8);
    let execution = acquisition::ExecutionGate::new(acquisition::AcquisitionRunState::Paused);
    let session = factory
        .open(
            validated,
            DriverContext {
                connection_epoch: 1,
                source_id: SourceId::new("lifecycle-s7").unwrap(),
                state_sink,
                event_sink,
                execution: execution.clone(),
            },
        )
        .await
        .unwrap();
    let (sink, mut receiver) = mpsc::channel(2);
    session
        .subscriber()
        .unwrap()
        .subscribe(
            SubscriptionIntent {
                points: vec![PointId("db_u16".into())],
                acquisition: AcquisitionIntent {
                    mode: AcquisitionMode::Poll,
                    requested_period_ms: Some(10),
                    deadband: None,
                    priority: Priority::Normal,
                    delivery: DeliveryClass::State,
                },
            },
            sink,
        )
        .await
        .unwrap();

    assert!(
        tokio::time::timeout(Duration::from_millis(40), receiver.recv())
            .await
            .is_err()
    );
    execution.set(acquisition::AcquisitionRunState::Running);
    let batch = tokio::time::timeout(Duration::from_secs(1), receiver.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(batch.payload.samples.len(), 1);

    execution.set(acquisition::AcquisitionRunState::Paused);
    while receiver.try_recv().is_ok() {}
    assert!(
        tokio::time::timeout(Duration::from_millis(40), receiver.recv())
            .await
            .is_err()
    );
    execution.set(acquisition::AcquisitionRunState::Stopped);
    session.close().await.unwrap();
}

#[tokio::test]
async fn timeout_is_reported_as_bad_communication_quality() {
    let port = spawn_silent_server().await;
    let mut points = standard_points().await;
    points.truncate(1);
    let mut payload = driver_payload(port, points);
    payload.payload["timeoutMs"] = serde_json::json!(50);
    payload.payload["reconnect"]["maxAttempts"] = serde_json::json!(0);
    let factory = S7Factory::default();
    let validated = factory.validate(&payload).unwrap();
    let (sink, _) = mpsc::channel(1);
    let session = factory
        .open(
            validated,
            DriverContext {
                connection_epoch: 1,
                source_id: SourceId::new("timeout-s7").unwrap(),
                state_sink: sink.clone(),
                event_sink: sink,
                execution: acquisition::ExecutionGate::new(
                    acquisition::AcquisitionRunState::Running,
                ),
            },
        )
        .await
        .unwrap();
    let result = session
        .reader()
        .unwrap()
        .read(ReadRequest {
            points: vec![PointId("db_u16".into())],
        })
        .await
        .unwrap();
    let quality = &result.batch.payload.samples[0].quality;
    assert_eq!(quality.validity, points::Validity::Bad);
    assert_ne!(quality.flags & points::quality_flags::COMM_FAILURE, 0);
    assert_eq!(quality.native.as_ref().unwrap().code, "timeout");
    session.close().await.unwrap();
}

#[tokio::test]
async fn close_cancels_an_in_flight_read_before_its_timeout() {
    let port = spawn_silent_server().await;
    let mut points = standard_points().await;
    points.truncate(1);
    let mut payload = driver_payload(port, points);
    payload.payload["timeoutMs"] = serde_json::json!(2_000);
    payload.payload["reconnect"]["maxAttempts"] = serde_json::json!(0);
    let factory = S7Factory::default();
    let validated = factory.validate(&payload).unwrap();
    let (sink, _) = mpsc::channel(1);
    let session = factory
        .open(
            validated,
            DriverContext {
                connection_epoch: 1,
                source_id: SourceId::new("cancel-s7").unwrap(),
                state_sink: sink.clone(),
                event_sink: sink,
                execution: acquisition::ExecutionGate::new(
                    acquisition::AcquisitionRunState::Running,
                ),
            },
        )
        .await
        .unwrap();
    let started = tokio::time::Instant::now();
    let read = session.reader().unwrap().read(ReadRequest {
        points: vec![PointId("db_u16".into())],
    });
    let close = async {
        tokio::time::sleep(Duration::from_millis(20)).await;
        session.close().await
    };
    let (read_result, close_result) = tokio::join!(read, close);
    close_result.unwrap();
    let quality = &read_result.unwrap().batch.payload.samples[0].quality;
    assert_eq!(quality.native.as_ref().unwrap().code, "cancelled");
    assert!(started.elapsed() < Duration::from_millis(500));
}

#[tokio::test]
async fn disconnected_read_reconnects_before_returning_a_sample() {
    let mock = ReconnectingMockServer::spawn().await;
    let mut points = standard_points().await;
    points.truncate(1);
    let session = open_session(mock.port, points).await;
    let result = session
        .reader()
        .unwrap()
        .read(ReadRequest {
            points: vec![PointId("db_u16".into())],
        })
        .await;
    // First request lands on the connection that dies; the retried request
    // must be served over a fresh connection with a new epoch.
    assert_eq!(
        mock.connections.load(std::sync::atomic::Ordering::Relaxed),
        2
    );
    let result = result.unwrap();
    assert_eq!(
        result.batch.payload.samples[0].value,
        Some(PointValue::U64(0))
    );
    assert_eq!(session.epoch(), 2);
    assert_eq!(
        session.state(),
        acquisition::SourceState::Online {
            connection_epoch: 2,
        }
    );
    session.close().await.unwrap();
}

#[tokio::test]
async fn acquisition_runtime_opens_reads_caches_and_closes_the_adapter() {
    let mock = MockServer::spawn().await;
    mock.poke(AREA_DB, 10, 0, &[0x12, 0x34]).await;
    let registry = Arc::new(DriverRegistry::new());
    let execution = acquisition::ExecutionGate::new(acquisition::AcquisitionRunState::Running);
    registry
        .register(Arc::new(s7_adapter::S7Driver::new(execution.clone())))
        .unwrap();
    let runtime = AcquisitionRuntime::new(Arc::new(DeviceTreeAcquisition::with_execution(
        registry, execution,
    )));
    let endpoint_id = NodeId::new("s7-runtime").unwrap();
    let snapshot = runtime
        .open_node(runtime_node(
            "s7-runtime",
            "S7 runtime",
            "s7",
            driver_payload(mock.port, standard_points().await),
        ))
        .await
        .unwrap();
    let payload = driver_payload(mock.port, standard_points().await);
    assert_eq!(runtime.descriptors(&payload).unwrap().len(), 6);
    assert!(snapshot.capabilities.read);

    let result = runtime
        .read(&endpoint_id, vec![PointId("db_u16".into())])
        .await
        .unwrap();
    assert_eq!(
        result.batch.payload.samples[0].value,
        Some(PointValue::U64(0x1234))
    );
    assert_eq!(runtime.latest_samples(&endpoint_id).unwrap().len(), 1);

    let duplicate = runtime
        .open_node(runtime_node(
            "s7-runtime",
            "duplicate",
            "s7",
            driver_payload(mock.port, standard_points().await),
        ))
        .await;
    assert!(matches!(
        duplicate,
        Err(acquisition::AcquisitionError::Busy)
    ));

    runtime.close_node(&endpoint_id).await.unwrap();
    assert!(matches!(
        runtime.snapshot(&endpoint_id),
        Err(acquisition::AcquisitionError::UnknownNode(_))
    ));
}

#[tokio::test]
async fn writes_enforce_deadlines_access_and_native_types() {
    let mock = MockServer::spawn().await;
    let session = open_session(mock.port, standard_points().await).await;
    let expired = session
        .writer()
        .unwrap()
        .write(WriteRequest {
            correlation_id: "expired".into(),
            deadline_unix_ns: 0,
            idempotency_key: None,
            items: Vec::new(),
        })
        .await;
    assert!(matches!(
        expired,
        Err(acquisition::AcquisitionError::Timeout)
    ));

    let result = session
        .writer()
        .unwrap()
        .write(WriteRequest {
            correlation_id: "invalid-writes".into(),
            deadline_unix_ns: i64::MAX,
            idempotency_key: None,
            items: vec![
                WriteItem {
                    point_id: PointId("input_byte".into()),
                    value: PointValue::U64(1),
                },
                WriteItem {
                    point_id: PointId("marker_bool".into()),
                    value: PointValue::U64(1),
                },
            ],
        })
        .await
        .unwrap();
    assert_eq!(
        result.items[0].quality.native.as_ref().unwrap().code,
        "readOnly"
    );
    assert_eq!(
        result.items[1].quality.native.as_ref().unwrap().code,
        "typeMismatch"
    );
    session.close().await.unwrap();
}

fn now_unix_ns() -> i64 {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos(),
    )
    .unwrap_or(i64::MAX)
}
