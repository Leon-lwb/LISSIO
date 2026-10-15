//! 本地 MCP server 的运行时状态 — 启动 / 停止 / 端口检查与冲突诊断。
//!
//! 这个 server 把本应用的软件能力暴露给**外部** AI 客户端 (Claude Desktop 等),
//! 端口是用户可见的配置 (设置 → AI → MCP, 落盘在 `settings.json`), 因此:
//!
//! - 显式端口是唯一权威: 与当前监听不同就切换监听, 而不是"已经在跑就无视新端口"。
//!   `None` / `Some(0)` 表示只要求"任意可用端口"，已有监听直接复用。
//! - 冲突不是一个只进日志的字符串: 失败原因、占用进程与替代端口随
//!   [`McpServerStatus`] 回传前端, 界面才能给出"改端口 / 关闭 MCP"的处置建议。

use std::sync::Arc;

use error::Result;
use mcp_server::{McpServerHandle, PortCheck};
use serde::Serialize;

use crate::AiHost;

/// 本地 MCP server 状态。
#[derive(Debug, Serialize)]
pub struct McpServerStatus {
    /// 是否在运行。
    pub running: bool,
    /// 运行端口 (未运行为 `null`)。
    pub port: Option<u16>,
    /// 最近一次启动失败的端口冲突 (成功后清空)。
    pub conflict: Option<McpPortConflict>,
}

/// 启动失败时的端口冲突诊断 — 前端据此给出处置建议。
#[derive(Debug, Clone, Serialize)]
pub struct McpPortConflict {
    /// 冲突端口 (即用户配置的那个)。
    pub port: u16,
    /// 后端 bind 失败的原始原因。
    pub reason: String,
    /// 占用该端口的进程 (识别不到为 `null`)。
    pub occupant: Option<String>,
    /// 未识别到占用进程 — 多为系统保留区间 (Hyper-V / WSL2 / Docker) 或权限限制。
    pub reserved_hint: bool,
    /// 建议改用的可用端口 (找不到为 `null`)。
    pub suggested_port: Option<u16>,
}

impl McpPortConflict {
    /// 由一次失败的 bind 构造 — 端口诊断是事后快照 (占用者可能刚释放)。
    fn from_failure(port: u16, reason: String) -> Self {
        let check = mcp_server::check_port(port);
        Self {
            port,
            reason,
            reserved_hint: check.occupant.is_none(),
            occupant: check.occupant,
            suggested_port: check.suggested_port,
        }
    }
}

/// 显式端口是否要求重新绑定 — `None` / `0` 只要求"任意可用端口"。
const fn wants_rebind(requested: Option<u16>, bound: u16) -> bool {
    match requested {
        None | Some(0) => false,
        Some(port) => port != bound,
    }
}

/// 当前仍在监听的端口 — 句柄存在但内部任务已退出时返回 `None`。
fn running_port(slot: &mut Option<McpServerHandle>) -> Option<u16> {
    let handle = slot.as_mut()?;
    handle.check_running().ok().filter(|running| *running)?;
    Some(handle.port)
}

/// 查询本地 MCP server 状态 (含最近一次端口冲突)。
pub fn mcp_server_status(state: &AiHost) -> McpServerStatus {
    let bound = running_port(&mut state.server.lock());
    if let Some(port) = bound {
        return McpServerStatus {
            running: true,
            port: Some(port),
            conflict: None,
        };
    }
    McpServerStatus {
        running: false,
        port: None,
        conflict: state.mcp_conflict.lock().clone(),
    }
}

/// 检查一个候选端口能否用于监听 (设置页即时反馈)。
#[must_use]
pub fn mcp_port_check(port: u16) -> PortCheck {
    mcp_server::check_port(port)
}

/// 启动本地 MCP server, 返回实际监听端口。
///
/// 端口语义: 显式 `port` 是唯一权威 — 与当前监听端口不同时会**切换**监听
/// (先收旧监听再绑新端口); 因此切换失败时旧监听不会留下 (失败原因记进
/// [`McpPortConflict`] 供前端展示)。`None` / `Some(0)` 复用已有监听。
///
/// # Errors
/// 端口被占用或 bind 失败 ([`McpError::ServerStart`])。
pub async fn mcp_server_start(state: &AiHost, port: Option<u16>) -> Result<u16> {
    let requested = mcp_server::resolve_port(port);
    {
        let mut guard = state.server.lock();
        if let Some(bound) = running_port(&mut guard)
            && !wants_rebind(port, bound)
        {
            return Ok(bound);
        }
        // 端口不同 (或旧监听已失效): 显式收掉, 不依赖 Drop 隐式关闭。
        if let Some(mut stale) = guard.take() {
            stale.stop();
        }
    }

    // 端口配置归后端: 显式设置 > LISSIO_MCP_PORT > DEFAULT_MCP_PORT
    let started = mcp_server::start(
        Arc::clone(&state.registry),
        state.toolbox.clone(),
        state.sink.clone(),
        requested,
    )
    .await;
    match started {
        Ok(handle) => {
            let bound = handle.port;
            *state.server.lock() = Some(handle);
            *state.mcp_conflict.lock() = None;
            Ok(bound)
        }
        Err(error) => {
            let conflict = McpPortConflict::from_failure(requested, error.to_string());
            log::error!(
                "MCP server 启动失败: 端口 {requested} — {} (占用者: {}, 建议端口: {:?})",
                conflict.reason,
                conflict.occupant.as_deref().unwrap_or("未识别"),
                conflict.suggested_port
            );
            *state.mcp_conflict.lock() = Some(conflict);
            Err(error)
        }
    }
}

/// 停止本地 MCP server (未运行时静默), 并清掉过期的冲突诊断。
pub fn mcp_server_stop(state: &AiHost) {
    let taken = state.server.lock().take();
    if let Some(mut handle) = taken {
        handle.stop();
    }
    *state.mcp_conflict.lock() = None;
}

#[cfg(test)]
#[path = "local_server_tests.rs"]
mod tests;
