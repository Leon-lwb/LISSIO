//! `can_load` — CAN 负载统计 Tauri 命令
//!
//! 层级: L4 cmd — CAN 负载统计/CSV 导出为命令层自包含领域逻辑; 允许依赖 L0-L3。

#[allow(clippy::module_inception)] // 领域目录 mod.rs + 同名核心文件为既定布局
mod can_load;

pub use can_load::*;
