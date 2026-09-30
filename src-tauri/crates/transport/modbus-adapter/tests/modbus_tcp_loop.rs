use acquisition::{AcquisitionRuntime, DriverContext, SourceFactory, SubscriptionIntent};
use data_model::device::DriverPayload;
use data_model::device_tree::{DriverId, NodeDecl, NodeId};
use device_tree::{DeviceTreeAcquisition, DriverRegistry};
use flow::SourceId;
use modbus_adapter::{
    ByteOrder, DRIVER_ID, ModbusArea, ModbusConfig, ModbusDataType, ModbusFactory, ModbusPoint,
    ReconnectConfig, SCHEMA_VERSION, WordOrder,
};
use points::{
    AcquisitionIntent, AcquisitionMode, DeliveryClass, PointId, PointValue, Priority, ReadRequest,
    WriteItem, WriteRequest,
};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, mpsc};

fn runtime_node(id: &str, label: &str, driver: &str, payload: DriverPayload) -> NodeDecl {
    let mut node =
        NodeDecl::leaf(id, label, driver, payload.schema_version, payload.payload).unwrap();
    node.capability_endpoint_id = Some("client".into());
    node
}

#[derive(Clone, Debug, PartialEq)]
struct RequestRecord {
    function: u8,
    address: u16,
    quantity_or_value: u16,
}

async fn spawn_mock() -> (u16, Arc<Mutex<Vec<RequestRecord>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let records = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&records);
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        serve(stream, captured).await;
    });
    (port, records)
}

async fn spawn_timeout_mock() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = [0_u8; 12];
        let _ = stream.read_exact(&mut request).await;
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    });
    port
}

async fn spawn_reconnect_mock() -> (u16, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let connections = Arc::new(AtomicUsize::new(0));
    let observed = Arc::clone(&connections);
    tokio::spawn(async move {
        let (mut first, _) = listener.accept().await.unwrap();
        observed.fetch_add(1, Ordering::Relaxed);
        let mut request = [0_u8; 12];
        let _ = first.read_exact(&mut request).await;
        drop(first);
        let (second, _) = listener.accept().await.unwrap();
        observed.fetch_add(1, Ordering::Relaxed);
        serve(second, Arc::new(Mutex::new(Vec::new()))).await;
    });
    (port, connections)
}

async fn serve(mut stream: TcpStream, records: Arc<Mutex<Vec<RequestRecord>>>) {
    loop {
        let mut header = [0_u8; 7];
        if stream.read_exact(&mut header).await.is_err() {
            break;
        }
        let length = usize::from(u16::from_be_bytes([header[4], header[5]]));
        let mut pdu = vec![0_u8; length.saturating_sub(1)];
        if stream.read_exact(&mut pdu).await.is_err() {
            break;
        }
        let function = pdu[0];
        let address = u16::from_be_bytes([pdu[1], pdu[2]]);
        let quantity_or_value = u16::from_be_bytes([pdu[3], pdu[4]]);
        records.lock().await.push(RequestRecord {
            function,
            address,
            quantity_or_value,
        });
        let response_pdu = response(function, address, quantity_or_value, &pdu);
        let response_length = u16::try_from(response_pdu.len() + 1).unwrap();
        let mut response = Vec::with_capacity(response_pdu.len() + 7);
        response.extend_from_slice(&header[..4]);
        response.extend_from_slice(&response_length.to_be_bytes());
        response.push(header[6]);
        response.extend_from_slice(&response_pdu);
        stream.write_all(&response).await.unwrap();
    }
}

fn response(function: u8, address: u16, quantity: u16, pdu: &[u8]) -> Vec<u8> {
    match function {
        1 => vec![1, 1, 0b0000_0001],
        2 => vec![2, 1, 0],
        3 | 4 if address == 99 => vec![function | 0x80, 2],
        3 => register_response(3, &[0x1234, 0x3f80, 0x0000][..usize::from(quantity)]),
        4 => register_response(4, &[0x4321][..usize::from(quantity)]),
        5 | 6 => pdu.to_vec(),
        16 => vec![16, pdu[1], pdu[2], pdu[3], pdu[4]],
        _ => vec![function | 0x80, 1],
    }
}

fn register_response(function: u8, registers: &[u16]) -> Vec<u8> {
    let mut response = vec![function, u8::try_from(registers.len() * 2).unwrap()];
    for register in registers {
        response.extend_from_slice(&register.to_be_bytes());
    }
    response
}

fn point(id: &str, area: ModbusArea, address: u16, data_type: ModbusDataType) -> ModbusPoint {
    ModbusPoint {
        id: PointId(id.into()),
        area,
        address,
        data_type,
        byte_order: ByteOrder::Big,
        word_order: WordOrder::Big,
        scale: 1.0,
        offset: 0.0,
        poll_period_ms: 20,
    }
}

async fn open_session(port: u16) -> Box<dyn acquisition::SourceSession> {
    let payload = driver_payload(port);
    let factory = ModbusFactory::default();
    let validated = factory.validate(&payload).unwrap();
    let (state_sink, _) = mpsc::channel(8);
    let (event_sink, _) = mpsc::channel(8);
    factory
        .open(
            validated,
            DriverContext {
                connection_epoch: 1,
                source_id: SourceId::new("plc").unwrap(),
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

fn driver_payload(port: u16) -> DriverPayload {
    let config = ModbusConfig {
        host: "127.0.0.1".into(),
        port,
        unit_id: 7,
        timeout_ms: 500,
        reconnect: ReconnectConfig {
            max_attempts: 1,
            initial_delay_ms: 1,
            max_delay_ms: 2,
        },
        points: vec![
            point("coil", ModbusArea::Coils, 0, ModbusDataType::Bool),
            point(
                "discrete",
                ModbusArea::DiscreteInputs,
                0,
                ModbusDataType::Bool,
            ),
            point(
                "holding_u16",
                ModbusArea::HoldingRegisters,
                10,
                ModbusDataType::U16,
            ),
            point(
                "holding_f32",
                ModbusArea::HoldingRegisters,
                11,
                ModbusDataType::F32,
            ),
            point("input", ModbusArea::InputRegisters, 0, ModbusDataType::U16),
            point(
                "exception",
                ModbusArea::HoldingRegisters,
                99,
                ModbusDataType::U16,
            ),
        ],
    };
    DriverPayload {
        driver_id: DriverId(DRIVER_ID.into()),
        schema_version: SCHEMA_VERSION,
        payload: serde_json::to_value(config).unwrap(),
    }
}

#[tokio::test]
async fn reads_all_areas_plans_contiguous_registers_and_writes() {
    let (port, records) = spawn_mock().await;
    let session = open_session(port).await;
    acquisition::validate_capability_contract(session.as_ref()).unwrap();
    let read = session
        .reader()
        .unwrap()
        .read(ReadRequest {
            points: ["coil", "discrete", "holding_u16", "holding_f32", "input"]
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
            Some(PointValue::Bool(true)),
            Some(PointValue::Bool(false)),
            Some(PointValue::U64(0x1234)),
            Some(PointValue::F64(1.0)),
            Some(PointValue::U64(0x4321)),
        ]
    );

    let deadline = i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
    )
    .unwrap()
        + 1_000_000_000;
    let write = session
        .writer()
        .unwrap()
        .write(WriteRequest {
            correlation_id: "command-1".into(),
            deadline_unix_ns: deadline,
            idempotency_key: None,
            items: vec![
                WriteItem {
                    point_id: PointId("coil".into()),
                    value: PointValue::Bool(false),
                },
                WriteItem {
                    point_id: PointId("holding_f32".into()),
                    value: PointValue::F64(2.0),
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

    let records = records.lock().await;
    assert!(records.contains(&RequestRecord {
        function: 3,
        address: 10,
        quantity_or_value: 3
    }));
    assert!(records.iter().any(|request| request.function == 5));
    assert!(records.iter().any(|request| request.function == 16));
    drop(records);
    session.close().await.unwrap();
}

#[tokio::test]
async fn exception_is_a_bad_sample_with_native_status() {
    let (port, _) = spawn_mock().await;
    let session = open_session(port).await;
    let read = session
        .reader()
        .unwrap()
        .read(ReadRequest {
            points: vec![PointId("exception".into())],
        })
        .await
        .unwrap();
    let sample = &read.batch.payload.samples[0];
    assert!(sample.value.is_none());
    assert_eq!(sample.quality.validity, points::Validity::Bad);
    assert!(
        sample
            .quality
            .native
            .as_ref()
            .unwrap()
            .code
            .starts_with("exception:")
    );
    session.close().await.unwrap();
}

#[tokio::test]
async fn polling_subscription_uses_a_bounded_typed_sink() {
    let (port, _) = spawn_mock().await;
    let session = open_session(port).await;
    let (sink, mut receiver) = mpsc::channel(1);
    let effective = session
        .subscriber()
        .unwrap()
        .subscribe(
            SubscriptionIntent {
                points: vec![PointId("holding_u16".into())],
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
    let batch = tokio::time::timeout(std::time::Duration::from_secs(1), receiver.recv())
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
async fn polling_keeps_running_while_paused_and_stops_on_stop() {
    let (port, _) = spawn_mock().await;
    let factory = ModbusFactory::default();
    let validated = factory.validate(&driver_payload(port)).unwrap();
    let (state_sink, _) = mpsc::channel(8);
    let (event_sink, _) = mpsc::channel(8);
    let execution = acquisition::ExecutionGate::new(acquisition::AcquisitionRunState::Paused);
    let session = factory
        .open(
            validated,
            DriverContext {
                connection_epoch: 1,
                source_id: SourceId::new("lifecycle-plc").unwrap(),
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
                points: vec![PointId("holding_u16".into())],
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

    // 初始暂停: 订阅建立后仍会轮询 (暂停语义 = 只停发送)
    let batch = tokio::time::timeout(Duration::from_secs(1), receiver.recv())
        .await
        .expect("暂停态下 Modbus 轮询必须继续")
        .unwrap();
    assert_eq!(batch.payload.samples.len(), 1);

    let paused_epoch = execution.epoch();
    execution.set(acquisition::AcquisitionRunState::Running);
    assert!(execution.epoch() > paused_epoch);
    while receiver.try_recv().is_ok() {}
    let batch = tokio::time::timeout(Duration::from_secs(1), receiver.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(batch.payload.samples.len(), 1);

    // 停止才中止轮询: 逐步排空在途批次 (含阻塞在 sink.send 上的那一批),
    // 轮询循环随后在状态检查处退出 — 之后再无产出
    // 停止才中止轮询: 排空在途批次后轮询任务在状态检查处退出 —
    // 要么超时无产出, 要么通道关闭, 绝不会再收到批次
    execution.set(acquisition::AcquisitionRunState::Stopped);
    for _ in 0..3 {
        while receiver.try_recv().is_ok() {}
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    while receiver.try_recv().is_ok() {}
    match tokio::time::timeout(Duration::from_millis(80), receiver.recv()).await {
        Err(_) | Ok(None) => {}
        Ok(Some(batch)) => {
            panic!("停止后仍产出 {} 个样本", batch.payload.samples.len());
        }
    }
    session.close().await.unwrap();
}

#[tokio::test]
async fn acquisition_runtime_opens_reads_caches_and_closes_the_adapter() {
    let (port, _) = spawn_mock().await;
    let registry = Arc::new(DriverRegistry::new());
    let execution = acquisition::ExecutionGate::new(acquisition::AcquisitionRunState::Running);
    registry
        .register(Arc::new(modbus_adapter::ModbusTcpDriver::new(
            execution.clone(),
        )))
        .unwrap();
    let runtime = AcquisitionRuntime::new(Arc::new(DeviceTreeAcquisition::with_execution(
        registry, execution,
    )));
    let endpoint_id = NodeId::new("plc-runtime").unwrap();
    let snapshot = runtime
        .open_node(runtime_node(
            "plc-runtime",
            "PLC runtime",
            "modbus-tcp",
            driver_payload(port),
        ))
        .await
        .unwrap();
    let payload = driver_payload(port);
    assert_eq!(runtime.descriptors(&payload).unwrap().len(), 6);
    assert!(snapshot.capabilities.read);

    let result = runtime
        .read(&endpoint_id, vec![PointId("holding_u16".into())])
        .await
        .unwrap();
    assert_eq!(
        result.batch.payload.samples[0].value,
        Some(PointValue::U64(0x1234))
    );
    assert_eq!(runtime.latest_samples(&endpoint_id).unwrap().len(), 1);

    let duplicate = runtime
        .open_node(runtime_node(
            "plc-runtime",
            "duplicate",
            "modbus-tcp",
            driver_payload(port),
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
async fn timeout_is_reported_as_bad_communication_quality() {
    let port = spawn_timeout_mock().await;
    let mut payload = driver_payload(port);
    payload.payload["timeoutMs"] = serde_json::json!(20);
    payload.payload["reconnect"]["maxAttempts"] = serde_json::json!(0);
    let factory = ModbusFactory::default();
    let validated = factory.validate(&payload).unwrap();
    let (sink, _) = mpsc::channel(1);
    let session = factory
        .open(
            validated,
            DriverContext {
                connection_epoch: 1,
                source_id: SourceId::new("timeout-plc").unwrap(),
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
            points: vec![PointId("holding_u16".into())],
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
    let port = spawn_timeout_mock().await;
    let mut payload = driver_payload(port);
    payload.payload["timeoutMs"] = serde_json::json!(2_000);
    payload.payload["reconnect"]["maxAttempts"] = serde_json::json!(0);
    let factory = ModbusFactory::default();
    let validated = factory.validate(&payload).unwrap();
    let (sink, _) = mpsc::channel(1);
    let session = factory
        .open(
            validated,
            DriverContext {
                connection_epoch: 1,
                source_id: SourceId::new("cancel-plc").unwrap(),
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
        points: vec![PointId("holding_u16".into())],
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
    let (port, connections) = spawn_reconnect_mock().await;
    let session = open_session(port).await;
    let result = session
        .reader()
        .unwrap()
        .read(ReadRequest {
            points: vec![PointId("holding_u16".into())],
        })
        .await
        .unwrap();
    assert_eq!(
        result.batch.payload.samples[0].value,
        Some(PointValue::U64(0x1234))
    );
    assert_eq!(connections.load(Ordering::Relaxed), 2);
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
async fn writes_enforce_deadlines_access_and_native_types() {
    let (port, _) = spawn_mock().await;
    let session = open_session(port).await;
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

    let deadline = i64::MAX;
    let result = session
        .writer()
        .unwrap()
        .write(WriteRequest {
            correlation_id: "invalid-writes".into(),
            deadline_unix_ns: deadline,
            idempotency_key: None,
            items: vec![
                WriteItem {
                    point_id: PointId("input".into()),
                    value: PointValue::U64(1),
                },
                WriteItem {
                    point_id: PointId("coil".into()),
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
