//! 串口传输层 — 同步串口 + 跨平台系统设备描述枚举
//!
//! 通过 [`SerialBackend`] 注册到 `AcquisitionRuntime`; 通用串口 I/O 还能由
//! serial-hosted 协议注入 [`serial::SerialLifecycle`] 复用。

#[cfg(any(target_os = "linux", test))]
mod linux_ports;
mod ports;

#[cfg(target_os = "macos")]
mod macos_ports;

pub mod serial;
pub use serialport;

#[cfg(windows)]
pub mod windows_ports;

use acquisition::{TransportBackend, TransportConnection};
use async_trait::async_trait;
use data_model::TransportConfig;
use error::Result;
use schema_types::TestDataLink;
use std::collections::BTreeMap;

/// 串口元信息 → 发现端点 metadata (camelCase key, 与 modbus-adapter 对齐)
pub fn port_metadata(port: &data_model::PortInfo) -> BTreeMap<String, serde_json::Value> {
    let mut metadata = BTreeMap::new();
    metadata.insert(
        "deviceId".into(),
        serde_json::json!(format!("serial:{}", port.name)),
    );
    metadata.insert("portType".into(), serde_json::json!(port.port_type));
    if let Some(value) = port.vid {
        metadata.insert("vid".into(), serde_json::json!(value));
    }
    if let Some(value) = port.pid {
        metadata.insert("pid".into(), serde_json::json!(value));
    }
    if let Some(value) = &port.serial_number {
        metadata.insert("serialNumber".into(), serde_json::json!(value));
    }
    if let Some(value) = &port.manufacturer {
        metadata.insert("manufacturer".into(), serde_json::json!(value));
    }
    if let Some(value) = &port.product {
        metadata.insert("product".into(), serde_json::json!(value));
    }
    if let Some(value) = &port.description {
        metadata.insert("description".into(), serde_json::json!(value));
    }
    metadata
}

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
            .map(|port| {
                let metadata = port_metadata(&port);
                acquisition::DiscoveredEndpoint {
                    adapter_id: data_model::device::DriverId("serial".into()),
                    discovery_id: port.name.clone(),
                    display_name: port
                        .description
                        .or(port.product)
                        .unwrap_or_else(|| port.name.clone()),
                    configuration_patch: serde_json::json!({ "port_name": port.name }),
                    metadata,
                }
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

#[cfg(test)]
mod tests {
    use super::port_metadata;
    use data_model::PortInfo;

    #[test]
    fn metadata_includes_all_present_usb_fields() {
        let port = PortInfo {
            name: "/dev/ttyUSB0".into(),
            port_type: "USB".into(),
            vid: Some(0x1a86),
            pid: Some(0x7523),
            serial_number: Some("ABC123".into()),
            manufacturer: Some("wch.cn".into()),
            product: Some("USB Serial".into()),
            description: Some("System USB Serial".into()),
        };
        let metadata = port_metadata(&port);
        assert_eq!(
            metadata["description"],
            serde_json::json!("System USB Serial")
        );
        assert_eq!(metadata["portType"], serde_json::json!("USB"));
        assert_eq!(metadata["vid"], serde_json::json!(0x1a86));
        assert_eq!(metadata["pid"], serde_json::json!(0x7523));
        assert_eq!(metadata["serialNumber"], serde_json::json!("ABC123"));
        assert_eq!(metadata["manufacturer"], serde_json::json!("wch.cn"));
        assert_eq!(metadata["product"], serde_json::json!("USB Serial"));
    }

    #[test]
    fn metadata_omits_absent_fields() {
        let port = PortInfo {
            name: "COM3".into(),
            port_type: "PCI".into(),
            vid: None,
            pid: None,
            serial_number: None,
            manufacturer: None,
            product: None,
            description: None,
        };
        let metadata = port_metadata(&port);
        assert_eq!(metadata.len(), 2);
        assert_eq!(metadata["portType"], serde_json::json!("PCI"));
    }
}
