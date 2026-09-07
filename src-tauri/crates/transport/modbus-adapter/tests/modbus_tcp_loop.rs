use acquisition::{DriverContext, DriverId, DriverPayload, SourceFactory, SubscriptionIntent};
use flow::SourceId;
use modbus_adapter::{
    ByteOrder, ModbusArea, ModbusConfig, ModbusDataType, ModbusFactory, ModbusPoint,
    ReconnectConfig, WordOrder, DRIVER_ID, SCHEMA_VERSION,
};
use points::{
    AcquisitionIntent, AcquisitionMode, DeliveryClass, PointId, PointValue, Priority, ReadRequest,
    WriteItem, WriteRequest,
};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};

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
    let payload = DriverPayload {
        driver_id: DriverId(DRIVER_ID.into()),
        schema_version: SCHEMA_VERSION,
        payload: serde_json::to_value(config).unwrap(),
    };
    let factory = ModbusFactory::default();
    let validated = factory.validate(&payload).unwrap();
    let (state_sink, _) = mpsc::channel(8);
    let (event_sink, _) = mpsc::channel(8);
    factory
        .open(
            validated,
            DriverContext {
                source_id: SourceId::new("plc").unwrap(),
                state_sink,
                event_sink,
            },
        )
        .await
        .unwrap()
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
    assert!(write
        .items
        .iter()
        .all(|item| item.quality.validity == points::Validity::Good));

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
    assert!(sample
        .quality
        .native
        .as_ref()
        .unwrap()
        .code
        .starts_with("exception:"));
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
