//! 运行控制与常驻服务 — run start/pause/stop + serve。

use control_api::control;
use serde_json::Value;

use super::RunAction as CliRunAction;
use crate::Host;

/// 运行控制命令分发。
pub async fn run_control(host: &Host, action: &CliRunAction) -> Result<Value, String> {
    let run_action = match action {
        CliRunAction::Start => pipeline::RunAction::Start,
        CliRunAction::Pause => pipeline::RunAction::Pause,
        CliRunAction::Stop => pipeline::RunAction::Stop,
    };
    control::run_workspace(&host.toolbox, host.sink.as_ref(), run_action).await
}

/// 常驻服务 — 恢复工作区 → 启动录制与后台任务 → 进程内 MCP server → Ctrl-C 收尾。
///
/// 事件走 stderr JSON-lines (见 [`crate::events`]); MCP 工具与 CLI 子命令、
/// Tauri IPC 完全同源 (`control-api`)。
pub async fn serve(mcp_port: Option<u16>, no_restore: bool) -> Result<(), String> {
    let host = crate::assemble(!no_restore).await?;
    let port = mcp_server::resolve_port(mcp_port);
    let handle = mcp_server::start(host.toolbox.clone(), host.sink.clone(), port)
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
