//! CAN 桥接传输层 — Slcan (ASCII over serial) + CandleLight (原生 USB bulk)
//!
//! SLCAN/candleLight 设备通过 [`CanTransportBackend`] 注册到统一传输接口。
//! 字节流透传到协议层由 `SlcanEngine`/`CandleLightEngine` 解码成 CanFrame。

pub mod candle;
pub mod slcan;

use acquisition::{TransportBackend, TransportConnection};
use async_trait::async_trait;
use data_model::TransportConfig;
use error::Result;
use schema_types::TestDataLink;

/// CAN device adapter. SLCAN and candleLight differ only behind this factory;
/// the manager and data plane consume an identical byte connection.
pub struct CanTransportBackend;

#[async_trait]
impl TransportBackend for CanTransportBackend {
    fn supports_discovery(&self) -> bool {
        true
    }
    fn discover(&self, config: &TransportConfig) -> Result<Vec<acquisition::DiscoveredEndpoint>> {
        if matches!(config, TransportConfig::Slcan(_)) {
            return acquisition::TransportBackend::discover(&serial::SerialBackend, config);
        }
        Ok(candle::list_devices()?.into_iter().map(|device| {
            let mut metadata = std::collections::BTreeMap::new();
            metadata.insert("vid".into(), serde_json::json!(device.vid));
            metadata.insert("pid".into(), serde_json::json!(device.pid));
            if let Some(value) = &device.serial_number {
                metadata.insert("serialNumber".into(), serde_json::json!(value));
            }
            if let Some(value) = &device.manufacturer {
                metadata.insert("manufacturer".into(), serde_json::json!(value));
            }
            if let Some(value) = &device.product {
                metadata.insert("product".into(), serde_json::json!(value));
            }
            acquisition::DiscoveredEndpoint {
                adapter_id: data_model::device::DriverId("candle-light".into()),
                discovery_id: format!("{}:{}", device.bus, device.address),
                display_name: device.product.clone().unwrap_or_else(|| format!("USB {}:{}", device.bus, device.address)),
                configuration_patch: serde_json::json!({ "bus": device.bus, "address": device.address }),
                metadata,
            }
        }).collect())
    }
    fn name(&self) -> &'static str {
        "can-device"
    }

    fn accepts(&self, config: &TransportConfig) -> bool {
        matches!(
            config,
            TransportConfig::Slcan(_) | TransportConfig::CandleLight(_)
        )
    }

    async fn open(
        &self,
        config: TransportConfig,
        _link: TestDataLink,
    ) -> Result<TransportConnection> {
        let (write_tx, data_tx, cancel) = match config {
            TransportConfig::Slcan(config) => slcan::spawn(config)?,
            TransportConfig::CandleLight(config) => candle::spawn(config).await?,
            _ => unreachable!("backend selection must call accepts before open"),
        };
        Ok(TransportConnection::from_cancel_flag(
            write_tx, data_tx, cancel,
        ))
    }
}
