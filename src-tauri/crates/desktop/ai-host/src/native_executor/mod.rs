//! 原生工具执行器 — 内置 AI 直连软件自有能力。
//!
//! 工具分两类:
//! - **注册表后端直连**:数据读取/设备发送/连线/知识库等,经
//!   [`control_api::capabilities::CapabilityRegistry`] 动态派发 (与对外
//!   MCP server 完全同一份工具定义与实现,零重复)。
//! - **前端托管**:节点编辑等 UI 状态操作 — 画布状态 (widgets/位置/连线/撤销)
//!   在前端 zustand store,后端经 `ai_tool_invoke` 事件桥调用前端
//!   `toolHost`,前端执行后 `ai_tool_resolve` 回执,超时兜底。
//!
//! 与外部 MCP 工具共存时内置优先 (`CompositeExecutor` 路由)。

mod composite;
mod executor;
mod frontend;
mod title;

pub use composite::{CompositeExecutor, McpToolExecutor};
pub use executor::{NativeToolExecutor, NativeToolOptions, PendingCalls, ToolOutcome};
pub use title::ConversationTitleExecutor;
