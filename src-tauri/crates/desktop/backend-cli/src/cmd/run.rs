//! 运行控制与常驻服务 — run start/pause/stop + serve。
//!
//! `serve` 默认同时提供两个常驻出口: Web (HTTP-RPC + WebSocket, 由
//! [`backend_server`] 承载) 与 MCP; `--no-http` 退回"仅 MCP"的旧行为。

use std::net::IpAddr;
use std::path::PathBuf;

use control_api::control;
use serde_json::Value;

use super::RunAction as CliRunAction;
use crate::Host;

/// `serve` 的启动选项 (由 clap 参数装配)。
#[derive(Debug, Default)]
pub struct ServeOptions {
    /// 监听地址 (None = 环境变量 / loopback 默认)。
    pub bind: Option<IpAddr>,
    /// Web 出口端口。
    pub http_port: Option<u16>,
    /// 访问令牌 (优先级最高)。
    pub token: Option<String>,
    /// 令牌文件路径。
    pub token_file: Option<PathBuf>,
    /// 静态站点目录 (前端 `dist/`)。
    pub static_dir: Option<PathBuf>,
    /// 允许的跨源来源。
    pub cors_origins: Vec<String>,
    /// MCP 端口。
    pub mcp_port: Option<u16>,
    /// 不启动 MCP。
    pub no_mcp: bool,
    /// 只启动 MCP, 不监听 Web 出口。
    pub no_http: bool,
    /// 跳过工作区恢复。
    pub no_restore: bool,
}

/// 运行控制命令分发。
pub async fn run_control(host: &Host, action: &CliRunAction) -> Result<Value, String> {
    let run_action = match action {
        CliRunAction::Start => pipeline::RunAction::Start,
        CliRunAction::Pause => pipeline::RunAction::Pause,
        CliRunAction::Stop => pipeline::RunAction::Stop,
    };
    control::run_workspace(&host.state, host.sink.as_ref(), run_action).await
}

/// 常驻服务 — Web 出口 (+ 可选 MCP), 直至退出信号后收尾。
///
/// 事件端口由各出口自行注入: Web 出口用广播端口 (推给所有连接), 纯 MCP 模式
/// 沿用 stderr JSON-lines。装配本体与 GUI 组合根同源 (`backend-host`)。
pub async fn serve(options: ServeOptions) -> Result<(), String> {
    // 与 `lissio-server` 同一份端口决策: 显式参数 > `LISSIO_MCP_PORT` >
    // `settings.json` 的 `app.ai.mcpServerPort` > 默认端口。配置目录先解析一次,
    // 端口决策与 `ServerConfig::resolve` 使用同一个目录。
    let config_dir = backend_host::resolve_config_dir(None);
    let mcp_port = mcp_server::resolve_mcp_port(options.mcp_port, options.no_mcp, || {
        backend_host::SettingsStore::new(&config_dir).mcp_server_port()
    });

    if !options.no_http {
        let config = backend_server::ServerConfig::resolve(
            options.bind,
            options.http_port,
            options.token,
            options.token_file,
            options.static_dir,
            options.cors_origins,
            mcp_port,
            !options.no_restore,
            Some(config_dir),
        )?;
        return backend_server::serve(config).await;
    }

    // 仅 MCP (事件走 stderr JSON-lines)。`--no-mcp` 在这里同样生效: 两个出口都
    // 被关掉时明确报错, 而不是静默启动 MCP。
    let Some(port) = mcp_port else {
        return Err("--no-http 与 --no-mcp 同时给出: 没有可启动的出口".to_string());
    };
    let host = crate::assemble(!options.no_restore).await?;
    let handle = mcp_server::start(
        std::sync::Arc::new(control_api::capabilities::CapabilityRegistry::builtin()),
        host.state.clone(),
        host.sink.clone(),
        port,
    )
    .await
    .map_err(|error| error.to_string())?;
    eprintln!(
        "backend-cli serving: mcp http://127.0.0.1:{}/mcp (ctrl-c 退出)",
        handle.port
    );
    tokio::signal::ctrl_c()
        .await
        .map_err(|error| format!("监听 Ctrl-C 失败: {error}"))?;
    eprintln!("shutting down...");
    let mut handle = handle;
    handle.stop();
    crate::teardown(&host);
    Ok(())
}
