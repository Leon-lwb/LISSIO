//! MCP server 实现 — rmcp 工具 handler 与 HTTP 生命周期。
//!
//! 工具实现与状态切片在 [`control_api`]; 本模块只做协议适配、HTTP 宿主与
//! 监听端口配置。

mod handlers;
mod params;
mod runtime;

/// MCP HTTP 端点路径 (外部客户端配置的 URL 需指向它)。
pub const MCP_ENDPOINT_PATH: &str = "/mcp";

pub use handlers::VofaMcpServer;
pub use runtime::{DEFAULT_MCP_PORT, MCP_PORT_ENV, McpServerHandle, resolve_port, start};
