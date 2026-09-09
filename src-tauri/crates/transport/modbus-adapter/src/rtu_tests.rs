use crate::client::{Runtime, RuntimeConfig};
use crate::read::read_points;
use crate::{
    ByteOrder, ModbusArea, ModbusDataType, ModbusPoint, ModbusRtuConfig, ReconnectConfig,
    SerialDataBits, SerialFlowControl, SerialParity, SerialStopBits, WordOrder,
};
use flow::SourceId;
use points::{PointId, PointValue};
use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{watch, Mutex};
use tokio_modbus::Slave;

#[tokio::test]
async fn rtu_client_reads_from_a_controlled_byte_stream() {
    let (client_io, mut simulator_io) = tokio::io::duplex(64);
    let simulator = tokio::spawn(async move {
        let mut request = [0_u8; 8];
        simulator_io.read_exact(&mut request).await.unwrap();
        assert_eq!(&request[..6], &[7, 3, 0, 0, 0, 1]);
        assert_eq!(
            u16::from_le_bytes([request[6], request[7]]),
            crc16(&request[..6])
        );
        let mut response = vec![7, 3, 2, 0x12, 0x34];
        response.extend_from_slice(&crc16(&response).to_le_bytes());
        simulator_io.write_all(&response).await.unwrap();
    });

    let point = ModbusPoint {
        id: PointId("holding".into()),
        area: ModbusArea::HoldingRegisters,
        address: 0,
        data_type: ModbusDataType::U16,
        byte_order: ByteOrder::Big,
        word_order: WordOrder::Big,
        scale: 1.0,
        offset: 0.0,
        poll_period_ms: 100,
    };
    let config = ModbusRtuConfig {
        port_name: "simulated".into(),
        baud_rate: 9_600,
        data_bits: SerialDataBits::Eight,
        parity: SerialParity::None,
        stop_bits: SerialStopBits::One,
        flow_control: SerialFlowControl::None,
        unit_id: 7,
        timeout_ms: 100,
        reconnect: ReconnectConfig::default(),
        points: vec![point.clone()],
    };
    let (closed, _) = watch::channel(false);
    let runtime = Arc::new(Runtime {
        config: RuntimeConfig::Rtu(config),
        points: HashMap::from([(point.id.clone(), point)]),
        context: Mutex::new(Some(tokio_modbus::client::rtu::attach_slave(
            client_io,
            Slave(7),
        ))),
        source_id: SourceId::new("rtu-simulator").unwrap(),
        sequence: AtomicU64::new(0),
        connection_epoch: AtomicU64::new(1),
        subscription: AtomicU64::new(0),
        execution: acquisition::ExecutionGate::new(acquisition::AcquisitionRunState::Running),
        state: parking_lot::RwLock::new(acquisition::SourceState::Online {
            connection_epoch: 1,
        }),
        closed,
    });

    let result = read_points(&runtime, &[PointId("holding".into())])
        .await
        .unwrap();
    assert_eq!(
        result.batch.payload.samples[0].value,
        Some(PointValue::U64(0x1234))
    );
    simulator.await.unwrap();
}

fn crc16(bytes: &[u8]) -> u16 {
    let mut crc = 0xffff_u16;
    for byte in bytes {
        crc ^= u16::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xa001
            } else {
                crc >> 1
            };
        }
    }
    crc
}
