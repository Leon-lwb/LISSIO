//! 显示订阅命令壳 — 编排在 [`app::display`] (L3), 推送经组合根的
//! [`crate::event_sink::TauriChannelSink`] 适配到 IPC `Channel`。

use app::AppState;
use app::display::{DisplayRequest, SubscriptionInfo};
use data_model::Result;
use tauri::State;
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::event_sink::TauriChannelSink;

/// 统一显示订阅。每个逻辑订阅只使用一个 Tauri Channel。
#[tauri::command]
pub async fn subscribe_data(
    state: State<'_, AppState>,
    request: DisplayRequest,
    on_event: Channel<InvokeResponseBody>,
    interval_ms: Option<u64>,
    max_items: Option<usize>,
) -> Result<SubscriptionInfo> {
    let sink = TauriChannelSink::handle(on_event);
    app::display::subscribe_data(state.inner(), request, sink, interval_ms, max_items).await
}

#[tauri::command]
pub async fn unsubscribe_data(state: State<'_, AppState>, channel_id: u32) -> Result<()> {
    app::display::unsubscribe_data(state.inner(), channel_id).await
}

/// 前端消费反馈。目前以运行时 Topic 保存控制状态。
#[tauri::command]
pub fn ack_data(
    state: State<'_, AppState>,
    subscription_id: u32,
    sequence: u64,
    buffered_bytes: usize,
    render_ms: f64,
) -> Result<()> {
    app::display::ack_data(
        state.inner(),
        subscription_id,
        sequence,
        buffered_bytes,
        render_ms,
    )
}

#[tauri::command]
pub fn get_data_health(state: State<'_, AppState>) -> Result<app::RuntimeHealth> {
    app::display::get_data_health(state.inner())
}
