//! 软件能力节点注册表 — MCP 工具、内置 AI 工具与技能文档的单一事实来源。
//!
//! 每个软件能力域 (传输/图编辑/波形/CAN/逻辑分析/采集控制/命令帧/录制/知识库)
//! 注册为一个 [`CapabilityNode`],声明自己的工具 ([`ToolDefinition`],schema 由
//! 入参类型 `JsonSchema` 派生) 与技能文档 ([`SkillDoc`])。全部出口运行期从
//! [`CapabilityRegistry`] 动态派发:
//!
//! - `mcp-server` — 按注册表构建 rmcp 工具路由;
//! - `ai-host` — 内置 AI 工具规格与执行分发、系统提示词知识库索引;
//! - 两者共用同一份 schema/描述/实现,新增能力域不需要修改任何出口代码。
//!
//! 本模块只做声明与分发;工具实现仍是 [`crate::tools`] / [`crate::control`] /
//! [`crate::data`] / [`crate::recording`] 中的普通异步函数 (CLI 同样直接调用)。

pub mod acquisition;
pub mod can;
pub mod command;
pub mod graph;
pub mod knowledge;
pub mod logic;
pub mod node;
pub mod recording;
pub mod registry;
pub mod skill;
pub mod tool;
pub mod transport;
pub mod waveform;

pub use node::CapabilityNode;
pub use registry::{CapabilityRegistry, RegistryError};
pub use skill::{Lang, SkillDoc};
pub use tool::{
    ToolContext, ToolDefinition, ToolError, ToolFuture, ToolHandler, ToolOutput, json_ok,
    json_result, tool, tool0,
};
