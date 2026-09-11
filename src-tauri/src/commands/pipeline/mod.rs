//! `pipeline` — 流水线参数 + 工作区运行控制 + 发送任务注册 + 触发器匹配 Tauri 命令
//!
//! 层级: L4 cmd — Tauri IPC 薄适配; 只依赖 L3 (app/ai) 与 L0 基座, L1/L2 类型经 app_state 转发, 禁止被任何非 cmd crate 依赖。

#[allow(clippy::module_inception)] // 领域目录 mod.rs + 同名核心文件为既定布局
mod pipeline;
mod run;
mod trigger;

pub use app::{TriggerMatchResult, TriggerMatcher, TriggerRuleDef};
pub use pipeline::*;
pub use run::*;
pub use trigger::*;
