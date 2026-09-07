//! `can_transport` — CAN 帧 / 传输 / 协议 Tauri 命令 (IPC 薄壳)
//!
//! 层级: L4 cmd — Tauri IPC 薄适配。连接编排、协议切换、CAN 编码发送等
//! 命令体已下沉 [`app_state`] 的 `transport_ops` / `protocol_ops` (L3 应用核心);
//! 协议引擎工厂在 [`pipeline::protocol_factory`] (L2)。
//!
//! 注意: 命令壳必须位于子模块 — tauri 对 `pub fn` 命令生成 `#[macro_export]`
//! 宏, 定义在 crate 根模块会与 macro_export 挂载点重名 (E0255)。

mod commands;

pub use app::LoopbackResult;
pub use commands::*;
