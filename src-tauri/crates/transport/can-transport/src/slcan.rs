use acquisition::ByteMessage;
use data_model::SlcanConfig;
use error::Result;
use error::TransportError;
use serial::serial::{SerialLifecycle, SerialSettings};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};

/// 启动 slcan 传输
///
/// 内部用 serialport 打开串口, 启动时发送 slcan 初始化命令。
/// 读线程广播原始字节 (包含 slcan ASCII 命令), 由 SlcanEngine 解析。
#[allow(clippy::type_complexity)]
pub fn spawn(
    config: SlcanConfig,
) -> Result<(
    mpsc::Sender<Vec<u8>>,
    broadcast::Sender<ByteMessage>,
    Arc<AtomicBool>,
)> {
    let settings = SerialSettings {
        port_name: config.port_name,
        baud_rate: config.baud_rate,
        data_bits: 8,
        parity: data_model::Parity::None,
        stop_bits: data_model::StopBits::One,
        flow_control: data_model::FlowControl::None,
        open_error: slcan_open_error,
    };
    serial::serial::spawn_with_lifecycle(
        settings,
        Arc::new(SlcanLifecycle {
            bitrate_command: config.can_bitrate.slcan_cmd(),
        }),
    )
}

struct SlcanLifecycle {
    bitrate_command: &'static str,
}

impl SerialLifecycle for SlcanLifecycle {
    fn on_open(&self, port: &mut dyn serial::serialport::SerialPort) -> Result<()> {
        let bitrate = format!("{}\r", self.bitrate_command);
        port.write_all(bitrate.as_bytes())
            .map_err(TransportError::SlcanBitrate)?;
        std::thread::sleep(Duration::from_millis(50));
        port.write_all(b"O\r")
            .map_err(TransportError::SlcanBitrate)?;
        std::thread::sleep(Duration::from_millis(50));
        Ok(())
    }

    fn on_close(&self, port: &mut dyn serial::serialport::SerialPort) {
        let _ = port.write_all(b"C\r");
    }
}

const fn slcan_open_error(port: String, source: std::io::Error) -> TransportError {
    TransportError::SlcanOpen { port, source }
}
