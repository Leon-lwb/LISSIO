//! 网络传输层 — TCP (client/server) + UDP socket
//!
//! TCP/UDP 的具体 socket 实现通过 [`NetworkBackend`] 注册到统一传输接口。

pub mod tcp;
pub mod udp;

use acquisition::{TransportBackend, TransportConnection};
use async_trait::async_trait;
use data_model::TransportConfig;
use error::Result;
use schema_types::TestDataLink;

/// TCP/UDP adapter. All network variants expose the same byte connection.
pub struct NetworkBackend;

#[async_trait]
impl TransportBackend for NetworkBackend {
    fn name(&self) -> &'static str {
        "network"
    }

    fn accepts(&self, config: &TransportConfig) -> bool {
        matches!(
            config,
            TransportConfig::Udp(_) | TransportConfig::TcpClient(_) | TransportConfig::TcpServer(_)
        )
    }

    async fn open(
        &self,
        config: TransportConfig,
        _link: TestDataLink,
    ) -> Result<TransportConnection> {
        let (write_tx, data_tx, cancel) = match config {
            TransportConfig::Udp(config) => udp::spawn(config).await?,
            TransportConfig::TcpClient(config) => tcp::spawn_client(config).await?,
            TransportConfig::TcpServer(config) => tcp::spawn_server(config).await?,
            _ => unreachable!("backend selection must call accepts before open"),
        };
        Ok(TransportConnection::from_cancel_flag(
            write_tx, data_tx, cancel,
        ))
    }
}
