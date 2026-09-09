//! 串口传输层 — 同步串口 + Windows COM Description 枚举
//!
//! 通过 [`SerialBackend`] 注册到 `AcquisitionRuntime`; 通用串口 I/O 还能由
//! serial-hosted 协议注入 [`serial::SerialLifecycle`] 复用。

pub mod serial;
pub use serialport;

#[cfg(windows)]
pub mod windows_ports;

use acquisition::{TransportBackend, TransportConnection};
use async_trait::async_trait;
use data_model::{Result, TransportConfig};
use schema_types::TestDataLink;

/// UART/serial device adapter for the transport registry.
pub struct SerialBackend;

#[async_trait]
impl TransportBackend for SerialBackend {
    fn supports_discovery(&self) -> bool {
        true
    }
    fn discover(&self, _config: &TransportConfig) -> Result<Vec<acquisition::DiscoveredEndpoint>> {
        Ok(serial::list_ports()?
            .into_iter()
            .map(|port| acquisition::DiscoveredEndpoint {
                adapter_id: data_model::device::DriverId("serial".into()),
                discovery_id: port.name.clone(),
                display_name: port.description.unwrap_or_else(|| port.name.clone()),
                configuration_patch: serde_json::json!({ "port_name": port.name }),
                metadata: std::collections::BTreeMap::new(),
            })
            .collect())
    }
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
