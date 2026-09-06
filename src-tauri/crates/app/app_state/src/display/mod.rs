//! 显示订阅服务 — 所有运行时显示数据的唯一订阅入口 (原 cmd/display 编排层)
//!
//! 层级: L3 app (app_state)。订阅编排 (spawn 循环 / 自适应速率 / 取消注册 /
//! 快照收集) 属应用核心; L4 cmd/display 只保留 `#[tauri::command]` 薄壳做
//! IPC 反序列化与调用转发。
//!
//! Tauri `Channel` 在此使用沿袭 crate 既有先例 (tauri 已是 L0/L2 既有依赖):
//! L3 侧接收 `Channel<InvokeResponseBody>` 作为推送 sink, 二进制编码
//! (VNDP/VENV/WWB1) 在 [`waveform_binary`] 与 [`stream::binary`]。

pub mod protocol;
pub mod snapshot;
pub mod stream;
pub mod waveform_binary;

pub use protocol::{DisplayEvent, DisplayRequest, RawDataOrigin, SubscriptionInfo};
pub use stream::{ack_data, get_data_health, subscribe_data, unsubscribe_data};
pub use waveform_binary::encode_waveform_window;
