//! `debug` — 调试相关 Tauri 命令
//!
//! 层级: L4 cmd — Tauri IPC 薄适配。

#[allow(clippy::module_inception)] // 领域目录 mod.rs + 同名核心文件为既定布局
mod debug;

pub use debug::*;
