//! `display` — 运行时显示数据统一订阅入口 (Tauri IPC 薄壳)
//!
//! 层级: L4 cmd — Tauri IPC 薄适配; 订阅编排 (spawn 循环 / 自适应速率 /
//! 快照收集 / 二进制编码) 在 [`app_state::display`] (L3 应用核心)。
//! DTO 类型自 app_state 转发, 保证前端契约与二进制命令注册路径不变。
//!
//! 注意: 命令壳必须位于子模块 — tauri 对 `pub fn` 命令生成 `#[macro_export]`
//! 宏, 定义在 crate 根模块会与 macro_export 挂载点重名 (E0255)。

mod commands;

pub use app_state::display::encode_waveform_window;
pub use app_state::display::{DisplayEvent, DisplayRequest, RawDataOrigin, SubscriptionInfo};
pub use commands::{ack_data, get_data_health, subscribe_data, unsubscribe_data};
