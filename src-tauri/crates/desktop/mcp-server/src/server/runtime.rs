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
/// 这是"没有设置文件来源"时的兜底 (Tauri AI 宿主的运行期重启走这条路径);
/// 启动期必须用 [`resolve_mcp_port`], 因为它在环境变量与默认值之间还有
/// `settings.json` 的 `app.ai.mcpServerPort` 一层。
pub fn resolve_port(explicit: Option<u16>) -> u16 {
    explicit.or_else(port_from_env).unwrap_or(DEFAULT_MCP_PORT)
}

/// `LISSIO_MCP_PORT` 的有效端口 — 未设置 / 空白 / 非法值都视为未配置。
fn port_from_env() -> Option<u16> {
    std::env::var(MCP_PORT_ENV)
        .ok()
        .and_then(|value| value.trim().parse().ok())
}

/// 启动期 MCP 端口决策 — 全部出口的唯一实现。
///
/// 优先级 (与 `docs/architecture/web-exit.md` 一致):
/// 显式参数 > `LISSIO_MCP_PORT` > 设置文件 `app.ai.mcpServerPort` >
/// [`DEFAULT_MCP_PORT`]。`disabled` (各根的 `--no-mcp`) 时返回 `None` — 调用方
/// 不得启动 MCP。
///
/// 设置文件由调用方以闭包注入: `settings.json` 的读写归 `backend-host`, 本适配器
/// 不反向依赖它 (那会形成 `mcp-server → backend-host → ai-host → mcp-server` 环)。
/// 两个组合根 (`lissio-server` 与 `backend-cli serve`) 因此共享同一份优先级,
/// 只有"读取设置"的那一行留在各自根里。
#[must_use]
pub fn resolve_mcp_port(
    explicit: Option<u16>,
    disabled: bool,
    settings_port: impl FnOnce() -> Option<u16>,
) -> Option<u16> {
    if disabled {
        return None;
    }
    Some(decide(explicit, port_from_env(), settings_port))
}

/// 纯优先级决策 — 只在前面的层都缺省时才调用设置层闭包 (短路), 便于穷举测试。
fn decide(explicit: Option<u16>, env: Option<u16>, settings: impl FnOnce() -> Option<u16>) -> u16 {
    explicit
        .or(env)
        .or_else(settings)
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

#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;
