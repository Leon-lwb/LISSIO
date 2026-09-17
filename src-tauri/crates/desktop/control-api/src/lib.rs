//! # control-api
//!
//! 后端控制能力核心 — 把本应用能力 (串口发送 / 数据读取 / 节点图编辑 /
//! 端点开闭 / 运行控制 / 录制 / 波形快照 / 命令帧) 实现为一组普通异步函数
//! + [`Toolbox`] 状态切片。
//!
//! 多个上层适配器共用同一份实现, 零重复:
//! - rmcp 适配器 (`mcp-server`) — 外部 AI 客户端的 MCP 工具
//! - 无界面 CLI (`backend-cli`) — 子命令与 `serve` 常驻
//! - 内置 AI 原生工具执行器 (`lissio` 命令层)
//!
//! 本 crate 不依赖 Tauri/rmcp: 事件与系统通知经 [`events::BackendEventSink`]
//! 端口注入, 显示数据流经 `app::display::StreamSink` 端口注入, 由组合根提供
//! 具体实现。

pub mod control;
pub mod data;
pub mod recording;
pub mod toolbox;
pub mod tools;

pub use toolbox::Toolbox;
