//! `lissio-server` 入口 — 无界面 Web 后端 (HTTP-RPC + WebSocket)。
//!
//! 与 `backend-cli` 是同一份装配的两个协议适配器: 本进程专注网络出口, CLI 专注
//! argv 子命令; 二者共享 `backend-host` 装配与 `rpc-api` 派发表。

use std::net::IpAddr;
use std::path::PathBuf;

use clap::Parser;

/// Lissio Web 后端 (HTTP-RPC + WebSocket)。
#[derive(Parser)]
#[command(name = "lissio-server", about = "Lissio Web 后端服务")]
struct Cli {
    /// 监听地址 (缺省 127.0.0.1, 可被 LISSIO_BIND 覆盖)
    #[arg(long)]
    bind: Option<IpAddr>,

    /// HTTP / WebSocket 端口 (缺省 8790, 可被 LISSIO_HTTP_PORT 覆盖)
    #[arg(long)]
    http_port: Option<u16>,

    /// 访问令牌 (缺省读 LISSIO_TOKEN, 再缺省读/生成配置目录下的 server-token)
    #[arg(long)]
    token: Option<String>,

    /// 令牌文件路径 (缺省 <配置目录>/server-token)
    #[arg(long)]
    token_file: Option<PathBuf>,

    /// 静态站点目录 (前端 dist/; 提供单进程完整应用)
    #[arg(long)]
    static_dir: Option<PathBuf>,

    /// 允许的跨源来源 (可重复; 缺省读 LISSIO_CORS_ORIGINS 逗号分隔)
    #[arg(long = "cors-origin")]
    cors_origins: Vec<String>,

    /// 同时启动进程内 MCP server 的端口 (缺省 8765)
    #[arg(long)]
    mcp_port: Option<u16>,

    /// 不启动 MCP server
    #[arg(long, conflicts_with = "mcp_port")]
    no_mcp: bool,

    /// 跳过启动时的工作区恢复 (空工作区启动)
    #[arg(long)]
    no_restore: bool,

    /// 显式配置目录 (缺省按平台语义解析, 可被 LISSIO_CONFIG_DIR 覆盖)
    #[arg(long)]
    config_dir: Option<PathBuf>,
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();
    let cli = Cli::parse();
    let config = match backend_server::ServerConfig::resolve(
        cli.bind,
        cli.http_port,
        cli.token,
        cli.token_file,
        cli.static_dir,
        cli.cors_origins,
        resolve_mcp_port(cli.mcp_port, cli.no_mcp),
        !cli.no_restore,
        cli.config_dir,
    ) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("配置解析失败: {error}");
            std::process::exit(2);
        }
    };
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("tokio runtime init failed: {error}");
            std::process::exit(1);
        }
    };
    if let Err(error) = runtime.block_on(backend_server::serve(config)) {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

/// MCP 端口决策: `--no-mcp` 关闭; 未显式给出时按环境变量/默认值启用。
fn resolve_mcp_port(explicit: Option<u16>, disabled: bool) -> Option<u16> {
    if disabled {
        return None;
    }
    Some(mcp_port(explicit))
}

/// 与 `mcp-server` 的端口解析保持一致 (显式 > `LISSIO_MCP_PORT` > 默认)。
fn mcp_port(explicit: Option<u16>) -> u16 {
    explicit
        .or_else(|| {
            std::env::var(mcp_server::MCP_PORT_ENV)
                .ok()
                .and_then(|value| value.trim().parse().ok())
        })
        .unwrap_or(mcp_server::DEFAULT_MCP_PORT)
}
