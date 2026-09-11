//! `buffer` — 波形缓冲区 + 窗口视觉效果 Tauri 命令
//!
//! 层级: L4 cmd — Tauri IPC 薄适配; 只依赖 L3 (app/ai) 与 L0 基座, L1/L2 类型经 app_state 转发, 禁止被任何非 cmd crate 依赖。

#[allow(clippy::module_inception)] // 领域目录 mod.rs + 同名核心文件为既定布局
mod buffer;
mod window;

pub use app::command_frame::*;
pub use app::frame_checksum::*;
pub use app::frame_field::*;
pub use buffer::*;
pub use window::*;
