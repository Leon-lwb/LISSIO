//! CAN 桥接传输层 — Slcan (ASCII over serial) + CandleLight (原生 USB bulk)
//!
//! SLCAN/candleLight 设备通过 [`CanTransportBackend`] 注册到统一传输接口。
//! 字节流透传到协议层由 `SlcanEngine`/`CandleLightEngine` 解码成 CanFrame。

pub mod candle;
pub mod slcan;

use async_trait::async_trait;
use data_model::{Result, TransportConfig};
use schema_types::TestDataLink;
use transport::{TransportBackend, TransportConnection};

/// CAN device adapter. SLCAN and candleLight differ only behind this factory;
/// the manager and data plane consume an identical byte connection.
pub struct CanTransportBackend;

#[async_trait]
impl TransportBackend for CanTransportBackend {
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
