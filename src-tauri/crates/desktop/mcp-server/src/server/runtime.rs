//! MCP HTTP 服务生命周期 — axum serve + 优雅关闭句柄 + 监听端口配置

use std::sync::Arc;

use control_api::Toolbox;
use control_api::capabilities::registry::CapabilityRegistry;
use error::McpError;
use error::Result as VofaResult;
use events::EventSinkHandle;

use super::MCP_ENDPOINT_PATH;
use super::VofaMcpServer;

/// 默认 MCP 监听端口 — 端口配置的后端权威默认值 (前端设置 / CLI flag 为显式覆盖)。
pub const DEFAULT_MCP_PORT: u16 = 8765;
/// 覆盖默认端口的进程环境变量。
pub const MCP_PORT_ENV: &str = "LISSIO_MCP_PORT";

/// 解析监听端口 — 优先级: 显式参数 > 环境变量 > [`DEFAULT_MCP_PORT`]。
///
/// `0` 表示由操作系统分配空闲端口 (启动后 [`McpServerHandle::port`] 回填真实值)。
///
/// 组合根在启动期会在环境变量与默认值之间插一层设置文件
/// (`app.ai.mcpServerPort`, 见 `lissio-server` 的端口决策与 `web-exit.md`),
/// 因此这里传进来的一般已是最终值; 本函数保留为"没有配置来源时"的兜底。
pub fn resolve_port(explicit: Option<u16>) -> u16 {
    explicit
        .or_else(|| {
            std::env::var(MCP_PORT_ENV)
                .ok()
                .and_then(|v| v.trim().parse().ok())
        })
        .unwrap_or(DEFAULT_MCP_PORT)
}

/// 正在运行的 MCP server 句柄 — 显式 [`McpServerHandle::stop`] 触发优雅关闭。
pub struct McpServerHandle {
    /// 实际监听端口。
    pub port: u16,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    done_rx: tokio::sync::oneshot::Receiver<std::io::Result<()>>,
}

impl McpServerHandle {
    /// 优雅停止 (幂等)。
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }

    /// 非阻塞检查 server 是否在运行 (内部任务出错则返回错误)。
    ///
    /// # Errors
    /// axum serve 任务以错误退出时返回 [`McpError::ServerStart`]。
    pub fn check_running(&mut self) -> VofaResult<bool> {
        match self.done_rx.try_recv() {
            Ok(Ok(())) => Ok(false),
            Ok(Err(source)) => Err(McpError::ServerStart {
                port: self.port,
                source: Box::new(source),
            }
            .into()),
            Err(tokio::sync::oneshot::error::TryRecvError::Empty) => Ok(true),
            Err(tokio::sync::oneshot::error::TryRecvError::Closed) => Ok(false),
        }
    }
}

/// 在 `127.0.0.1:{port}` 启动 MCP streamable-http server。
///
/// `registry` 是软件能力注册表 (工具清单单一事实来源); `sink` 是事件/通知端口 —
/// Tauri 组合根注入前端事件实现, 无界面宿主注入静默或日志实现, 本适配器不感知
/// 宿主差异。
///
/// # Errors
/// 端口占用等 bind 失败返回 [`McpError::ServerStart`]。
pub async fn start(
    registry: Arc<CapabilityRegistry>,
    toolbox: Toolbox,
    sink: EventSinkHandle,
    port: u16,
) -> VofaResult<McpServerHandle> {
    let service_factory = move || {
        Ok(VofaMcpServer::new(
            Arc::clone(&registry),
            toolbox.clone(),
            sink.clone(),
        ))
    };
    let session_manager = Arc::new(
        rmcp::transport::streamable_http_server::session::local::LocalSessionManager::default(),
    );
    let service = rmcp::transport::StreamableHttpService::new(
        service_factory,
        session_manager,
        rmcp::transport::StreamableHttpServerConfig::default(),
    );

    let router = axum::Router::new().route_service(MCP_ENDPOINT_PATH, service);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|source| McpError::ServerStart {
            port,
            source: Box::new(source),
        })?;
    let actual_port = listener.local_addr().ok().map_or(port, |a| a.port());

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let (done_tx, done_rx) = tokio::sync::oneshot::channel::<std::io::Result<()>>();
    tokio::spawn(async move {
        let server = axum::serve(listener, router).with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        });
        let _ = done_tx.send(server.await);
    });

    log::info!("MCP server 已启动: http://127.0.0.1:{actual_port}{MCP_ENDPOINT_PATH}");
    Ok(McpServerHandle {
        port: actual_port,
        shutdown_tx: Some(shutdown_tx),
        done_rx,
    })
}
