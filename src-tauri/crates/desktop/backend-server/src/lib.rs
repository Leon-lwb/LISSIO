//! # backend-server
//!
//! Web 出口组合根 — 把 [`control_api`] 的能力与 [`backend_host`] 的装配暴露为
//! HTTP-RPC + WebSocket, 供浏览器前端 (以及指向远端实例的桌面壳) 使用。
//!
//! 与其它出口的关系 (见 `docs/architecture/exits.md` 与
//! `docs/architecture/web-exit.md`):
//!
//! ```text
//! 浏览器 ──HTTP/WS──► backend-server ──► rpc-api ──► control-api / app
//! 桌面   ──HTTP/WS──► sidecar backend-server ─┘
//! 脚本   ──argv────► backend-cli ────────────┘
//! ```
//!
//! 三个出口共用同一份能力核心与同一份装配; 本 crate 只做协议适配 (帧编解码、
//! 鉴权、静态站点、订阅生命周期), 不承载业务判断。

mod diagnostics;
mod outbox;

pub mod config;
pub mod frames;
pub mod http;
pub mod session;
pub mod sink;

use std::io::Write as _;
use std::net::IpAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicUsize};

use backend_host::BackendHost;
use tokio::sync::broadcast;

pub use config::{DEFAULT_HTTP_PORT, ServerConfig};
pub use frames::{Capabilities, PROTOCOL_VERSION};
pub use sink::{BroadcastEventSink, ConnectionOutbox, OutFrame, OutboxStats, WsStreamSink};

/// 事件广播缓冲深度 — 单连接落后超过此值即丢帧并告警 (显示订阅走独立通道,
/// 不受影响)。
const EVENT_CHANNEL_CAPACITY: usize = 4096;

/// 导出产物暂存目录名 (位于配置目录下) — 只服务经 token 登记的产物。
pub const DOWNLOAD_DIR_NAME: &str = "downloads";

/// 服务运行期共享状态。
pub struct ServerState {
    /// 已装配后端宿主 (能力与状态切片)。
    pub host: Arc<BackendHost>,
    /// 出口配置。
    pub config: ServerConfig,
    /// 全局事件广播发送端 — [`BroadcastEventSink`] 持有同一发送端。
    pub broadcast: broadcast::Sender<frames::ServerMessage>,
    /// 进程级订阅 id 分配器 (与 `app::display` 的全局订阅表同一命名空间)。
    pub next_subscription_id: Arc<AtomicU32>,
    /// 当前活动 WebSocket 连接数。
    pub active_websockets: Arc<AtomicUsize>,
    /// 当前活动显示订阅数。
    pub active_display_subscriptions: Arc<AtomicUsize>,
}

impl ServerState {
    /// 出口能力清单 — 由 `rpc-api` 的命令分类派生, 不手工维护第二份。
    pub fn capabilities(&self) -> Capabilities {
        Capabilities {
            supported: rpc_api::catalog::SUPPORTED
                .iter()
                .map(|cmd| (*cmd).to_string())
                .collect(),
            pending: rpc_api::catalog::PENDING
                .iter()
                .map(|cmd| (*cmd).to_string())
                .collect(),
            desktop_only: rpc_api::catalog::DESKTOP_ONLY
                .iter()
                .map(|cmd| (*cmd).to_string())
                .collect(),
            protocol: PROTOCOL_VERSION,
        }
    }
}

/// 启动服务直至收到退出信号 (Ctrl-C / SIGTERM)。
///
/// 顺序与其它宿主一致: 装配 (含工作区恢复与录制启动) → 可选进程内 MCP →
/// HTTP/WS 监听 → 信号 → 优雅收尾 (停录制 + flush 工作区)。
///
/// # Errors
/// 装配失败、端口占用或 MCP 启动失败时返回原因。
pub async fn serve(config: ServerConfig) -> Result<(), String> {
    serve_inner(config, false).await
}

/// Sidecar entrypoint. In addition to OS signals, EOF or a line on stdin asks
/// the server to flush state and stop gracefully.
pub async fn serve_supervised(config: ServerConfig) -> Result<(), String> {
    serve_inner(config, true).await
}

async fn serve_inner(config: ServerConfig, supervised_stdio: bool) -> Result<(), String> {
    let (broadcast, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
    let sink = BroadcastEventSink::handle(&broadcast);
    let mut host =
        backend_host::assemble(config.config_dir.clone(), config.restore_workspace, sink).await?;
    // Web 出口注入导出产物暂存区: 导出命令改把产物写进受管目录, 经
    // `/api/v1/download/{token}` 交付 (浏览器没有可写路径)。
    host.artifacts = Some(Arc::new(backend_host::ArtifactStaging::new(
        host.config_dir.join(DOWNLOAD_DIR_NAME),
    )?));
    let host = Arc::new(host);

    if let Some(port) = config.mcp_port {
        let bound = ai_host::mcp_server_start(&host.ai, Some(port))
            .await
            .map_err(|error| error.to_string())?;
        log::info!("MCP server 已随 Web 出口启动: 端口 {bound}");
    }

    let listener = tokio::net::TcpListener::bind((config.bind, config.http_port))
        .await
        .map_err(|error| format!("监听 {}:{} 失败: {error}", config.bind, config.http_port))?;
    let actual_port = listener
        .local_addr()
        .map_or(config.http_port, |address| address.port());

    let state = Arc::new(ServerState {
        host: host.clone(),
        config: config.clone(),
        broadcast,
        next_subscription_id: Arc::new(AtomicU32::new(0)),
        active_websockets: Arc::new(AtomicUsize::new(0)),
        active_display_subscriptions: Arc::new(AtomicUsize::new(0)),
    });
    diagnostics::spawn(host.clone());
    log::info!("Web 出口已监听: http://{}:{actual_port}", config.bind);
    // stdout 是宿主 (桌面壳) 的握手管道, 不是普通终端: 宿主提前换掉子进程 / 关闭
    // 读端时写入会拿到 EPIPE, 而 `println!` 遇到写失败直接 panic — 真实事故里
    // 后端就是带着 "failed printing to stdout: Broken pipe" 整个退出的 (重启风暴
    // 期间连续两次)。握手信息写不出去只该让宿主判定 ready 超时, 不该带走后端。
    announce_ready(actual_port);
    if !config.is_loopback() {
        log::info!(
            "非 loopback 绑定 — 客户端需携带访问令牌 (LISSIO_TOKEN 或配置目录的 {})",
            config::TOKEN_FILE_NAME
        );
    }

    let app = http::router(state);
    let served = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(supervised_stdio))
        .await;
    log::info!("Web 出口停止监听, 正在收尾");
    ai_host::mcp_server_stop(&host.ai);
    backend_host::teardown(&host);
    served.map_err(|error| format!("HTTP 服务退出异常: {error}"))
}

/// 退出信号 — Ctrl-C 或 SIGTERM (容器/服务管理器的主流停止方式)。
async fn shutdown_signal(supervised_stdio: bool) {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => log::warn!("SIGTERM 监听不可用: {error}"),
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    let supervised = async move {
        if supervised_stdio {
            use tokio::io::AsyncBufReadExt as _;
            let mut input = tokio::io::BufReader::new(tokio::io::stdin());
            let mut line = String::new();
            let _ = input.read_line(&mut line).await;
        } else {
            std::future::pending::<()>().await;
        }
    };
    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
        () = supervised => {}
    }
    // 受监督进程: 关闭请求已到达, 进程必须在有界时间内退出。收尾若卡在某个
    // 后台线程上, 残留进程会一直持有录制数据库句柄 — Windows 的文件锁是强制的,
    // 下一次启动就会打不开数据库 (录制静默丢失)。受监督进程不能比关闭请求活得久。
    if supervised_stdio {
        let _watchdog = std::thread::spawn(|| {
            std::thread::sleep(TEARDOWN_DEADLINE);
            log::error!("收尾超时 ({}s), 强制退出进程", TEARDOWN_DEADLINE.as_secs());
            let _ = std::io::stdout().flush();
            let _ = std::io::stderr().flush();
            std::process::exit(1);
        });
    }
}

/// 受监督进程收尾的宽限时间 — 正常收尾 (停录制 + 工作区落盘) 远快于此,
/// 超时说明有线程卡住, 此时必须放弃收尾以保证进程退出。
const TEARDOWN_DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);

/// 默认监听地址 — 供二进制入口复用。
pub const DEFAULT_BIND: IpAddr = IpAddr::V4(std::net::Ipv4Addr::LOCALHOST);

/// 宿主握手行 (`LISSIO_READY=<json>`) — 单独成函数以便测试格式。
fn ready_line(port: u16) -> String {
    format!(
        "LISSIO_READY={{\"port\":{port},\"protocol\":\"{}\",\"version\":\"{}\"}}",
        PROTOCOL_VERSION,
        env!("CARGO_PKG_VERSION")
    )
}

/// 把握手行写进 stdout — 写失败只告警, 不 panic。
///
/// `println!` 在写失败时 panic: 宿主关闭管道 (换子进程 / 停止后端) 后后端会在
/// 握手这一步整个退出, 看起来像"后端自己重启"。这里降级为丢一条握手信息并告警,
/// 由宿主侧的 ready 超时兜底。
fn announce_ready(port: u16) {
    let mut stdout = std::io::stdout();
    if writeln!(stdout, "{}", ready_line(port)).is_err() {
        log::warn!("握手信息写入 stdout 失败 (宿主已关闭管道), 后端继续运行");
    }
    let _ = stdout.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_line_is_a_parseable_handshake_record() {
        let line = ready_line(64784);
        let payload = line
            .strip_prefix("LISSIO_READY=")
            .expect("握手行必须带 LISSIO_READY= 前缀");
        let parsed: serde_json::Value = serde_json::from_str(payload).expect("握手行必须是 JSON");
        assert_eq!(parsed["port"], 64784);
        assert_eq!(parsed["protocol"], PROTOCOL_VERSION);
        assert_eq!(parsed["version"], env!("CARGO_PKG_VERSION"));
    }
}
