use acquisition::ByteMessage;
use data_model::{INGEST_CHANNEL_CAPACITY, PortInfo, Result, SerialConfig};
use error::TransportError;
use serialport::{DataBits, FlowControl, Parity, StopBits};
use std::io::{Read, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};

/// Device-neutral serial settings shared by UART and serial-hosted protocols.
pub struct SerialSettings {
    pub port_name: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub parity: data_model::Parity,
    pub stop_bits: data_model::StopBits,
    pub flow_control: data_model::FlowControl,
    pub open_error: fn(String, std::io::Error) -> TransportError,
}

/// Protocol-specific serial lifecycle. Framing remains in the protocol crate;
/// this hook is only for device session setup/teardown commands.
pub trait SerialLifecycle: Send + Sync + 'static {
    fn on_open(&self, _port: &mut dyn serialport::SerialPort) -> Result<()> {
        Ok(())
    }

    fn on_close(&self, _port: &mut dyn serialport::SerialPort) {}
}

struct PlainSerial;

impl SerialLifecycle for PlainSerial {}

const fn serial_open_error(port: String, source: std::io::Error) -> TransportError {
    TransportError::SerialOpen { port, source }
}

/// Enumerate unique serial interfaces with normalized system descriptions.
pub fn list_ports() -> Result<Vec<PortInfo>> {
    crate::ports::list_ports()
}

/// 启动串口传输
///
/// 返回 (写入端, 数据广播端, 取消标志)
#[allow(clippy::type_complexity)]
pub fn spawn(
    config: SerialConfig,
) -> Result<(
    mpsc::Sender<Vec<u8>>,
    broadcast::Sender<ByteMessage>,
    Arc<AtomicBool>,
)> {
    spawn_with_lifecycle(
        SerialSettings {
            port_name: config.port_name,
            baud_rate: config.baud_rate,
            data_bits: config.data_bits,
            parity: config.parity,
            stop_bits: config.stop_bits,
            flow_control: config.flow_control,
            open_error: serial_open_error,
        },
        Arc::new(PlainSerial),
    )
}

/// Start a serial device with an injected session lifecycle.
#[allow(clippy::type_complexity)]
pub fn spawn_with_lifecycle(
    settings: SerialSettings,
    lifecycle: Arc<dyn SerialLifecycle>,
) -> Result<(
    mpsc::Sender<Vec<u8>>,
    broadcast::Sender<ByteMessage>,
    Arc<AtomicBool>,
)> {
    let mut port = serialport::new(&settings.port_name, settings.baud_rate)
        .data_bits(match settings.data_bits {
            5 => DataBits::Five,
            6 => DataBits::Six,
            7 => DataBits::Seven,
            _ => DataBits::Eight,
        })
        .parity(match settings.parity {
            data_model::Parity::Odd => Parity::Odd,
            data_model::Parity::Even => Parity::Even,
            data_model::Parity::None => Parity::None,
        })
        .stop_bits(match settings.stop_bits {
            data_model::StopBits::Two => StopBits::Two,
            data_model::StopBits::One => StopBits::One,
        })
        .flow_control(match settings.flow_control {
            data_model::FlowControl::Software => FlowControl::Software,
            data_model::FlowControl::Hardware => FlowControl::Hardware,
            data_model::FlowControl::None => FlowControl::None,
        })
        .timeout(Duration::from_millis(50))
        .open()
        .map_err(|error| (settings.open_error)(settings.port_name.clone(), error.into()))?;

    lifecycle.on_open(port.as_mut())?;

    let mut write_port = port
        .try_clone()
        .map_err(|e| TransportError::SerialClone(e.into()))?;

    let (data_tx, _) = broadcast::channel(INGEST_CHANNEL_CAPACITY);
    let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(64);
    let cancel = Arc::new(AtomicBool::new(false));

    // 读线程
    let data_tx_read = data_tx.clone();
    let cancel_read = cancel.clone();
    let read_lifecycle = lifecycle;
    std::thread::spawn(move || {
        let mut buf = vec![0u8; 65536].into_boxed_slice();
        while !cancel_read.load(Ordering::Relaxed) {
            match port.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = data_tx_read.send(ByteMessage::from_device(buf[..n].to_vec()));
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => break,
            }
        }
        read_lifecycle.on_close(port.as_mut());
        log::debug!("串口读线程退出");
    });

    // 写线程
    let cancel_write = cancel.clone();
    std::thread::spawn(move || {
        while !cancel_write.load(Ordering::Relaxed) {
            match write_rx.blocking_recv() {
                Some(data) => {
                    if let Err(e) = write_port.write_all(&data) {
                        log::error!("串口写入失败: {e}");
                        break;
                    }
                }
                None => break,
            }
        }
        log::debug!("串口写线程退出");
    });

    Ok((write_tx, data_tx, cancel))
}
