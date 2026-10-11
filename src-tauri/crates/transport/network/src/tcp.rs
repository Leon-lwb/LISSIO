use acquisition::ByteMessage;
use data_model::{TcpClientConfig, TcpServerConfig};
use error::Result;
use error::TransportError;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc};

/// 启动 TCP 客户端
pub async fn spawn_client(
    config: TcpClientConfig,
) -> Result<(
    mpsc::Sender<Vec<u8>>,
    broadcast::Sender<ByteMessage>,
    Arc<AtomicBool>,
)> {
    let addr = format!("{}:{}", config.host, config.port);
    let stream = TcpStream::connect(&addr)
        .await
        .map_err(|e| TransportError::TcpConnect {
            host: config.host.clone(),
            port: config.port,
            source: e,
        })?;

    let (read_half, write_half) = stream.into_split();

    Ok(acquisition::pump::spawn_byte_pump(
        read_half,
        write_half,
        "TCP 客户端",
    ))
}

/// 启动 TCP 服务端 (接受第一个连接)
pub async fn spawn_server(
    config: TcpServerConfig,
) -> Result<(
    mpsc::Sender<Vec<u8>>,
    broadcast::Sender<ByteMessage>,
    Arc<AtomicBool>,
)> {
    let addr = format!("{}:{}", config.listen_addr, config.listen_port);
    let listener = TcpListener::bind(&addr)
        .await
        .map_err(|e| TransportError::TcpListen {
            addr: addr.clone(),
            source: e,
        })?;

    let mut pump = acquisition::pump::BytePump::new();
    let (write_tx, data_tx, cancel) = pump.handles();
    let cancel_accept = Arc::clone(&cancel);

    // 接受连接, 之后交给共享读写泵
    tokio::spawn(async move {
        log::info!("TCP 服务端等待连接: {addr}");

        // 等待连接 (带取消)
        let stream = loop {
            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((stream, addr)) => {
                            log::info!("TCP 客户端已连接: {addr}");
                            break stream;
                        }
                        Err(e) => {
                            log::error!("TCP 接受连接失败: {e}");
                            return;
                        }
                    }
                }
                () = tokio::time::sleep(std::time::Duration::from_millis(100)) => {
                    if cancel_accept.load(Ordering::Relaxed) { return; }
                }
            }
        };

        let (read_half, write_half) = stream.into_split();
        pump.start(read_half, write_half, "TCP 服务端");
    });

    Ok((write_tx, data_tx, cancel))
}
