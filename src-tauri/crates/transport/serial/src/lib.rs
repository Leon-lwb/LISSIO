//! 串口传输层 — 同步串口 + Windows COM Description 枚举
//!
//! 通过 [`SerialBackend`] 注册到 `TransportManager`; 通用串口 I/O 还能由
//! serial-hosted 协议注入 [`serial::SerialLifecycle`] 复用。

pub mod serial;
pub use serialport;

#[cfg(windows)]
pub mod windows_ports;

use async_trait::async_trait;
use data_model::{Result, TransportConfig};
use schema_types::TestDataLink;
use transport::{TransportBackend, TransportConnection};

/// UART/serial device adapter for the transport registry.
pub struct SerialBackend;

#[async_trait]
impl TransportBackend for SerialBackend {
    fn name(&self) -> &'static str {
        "serial"
    }

    fn accepts(&self, config: &TransportConfig) -> bool {
        matches!(config, TransportConfig::Serial(_))
    }

    async fn open(
        &self,
        config: TransportConfig,
        _link: TestDataLink,
    ) -> Result<TransportConnection> {
        let TransportConfig::Serial(config) = config else {
            unreachable!("backend selection must call accepts before open")
        };
        let (write_tx, data_tx, cancel) = serial::spawn(config)?;
        Ok(TransportConnection::from_cancel_flag(
            write_tx, data_tx, cancel,
        ))
    }
}
