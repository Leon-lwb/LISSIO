//! # mcp_server
//!
//! 把 [`control_api`] 的软件能力暴露为 MCP server — 外部 AI 客户端
//! (Claude Desktop / ZCode 等) 通过 streamable-http 连接
//! `127.0.0.1:{port}/mcp`, 调用设备发送、字节注入、节点图编辑、波形读取、
//! 端点开闭、运行控制与知识库读取等工具, 实现 "AI 控制仪器"。
//!
//! 工具路由从 [`control_api::capabilities::CapabilityRegistry`] 运行期动态
//! 构建 — 注册表是工具清单的单一事实来源, 本 crate 只做协议适配
//! (rmcp 工具路由 + HTTP 宿主 + 端口配置): 工具实现与状态切片在
//! [`control_api`], 事件与系统通知经 [`events::BackendEventSink`] 端口注入。
//! 因此同一个服务器既可由 Tauri 组合根启动 (事件推给前端界面),
//! 也可由无界面 CLI 单进程启动。
//!
//! 仅监听 `127.0.0.1` — 不对局域网暴露。

pub mod server;

pub use server::{
    DEFAULT_MCP_PORT, MCP_ENDPOINT_PATH, MCP_PORT_ENV, McpServerHandle, PortCheck, VofaMcpServer,
    check_port, resolve_port, start,
};
