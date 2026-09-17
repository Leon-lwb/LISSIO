//! 原始数据 Tauri 命令 — 缓冲区容量/清空入口
//!
//! 原始数据订阅统一走 [`display`] 的 `subscribe_data` 单一入口 (VNDP 协议);
//! 本模块仅保留各缓冲区的容量设置与收集器清空命令 (实现在
//! [`control_api::data`], 与 MCP/CLI 共用)。

use app::AppState;
use control_api::data;
use data_model::Result;
use tauri::State;

/// 清空原始数据收集器 (source 指定的 Transport 源 / None = 全部源;
/// 各 FrameDecoder 节点旁路收集器总是同时清空)
#[tauri::command]
pub async fn clear_raw_data_collector(
    state: State<'_, AppState>,
    source: Option<String>,
) -> Result<()> {
    let tb = control_api::Toolbox::from_state(state.inner());
    data::clear_raw_data_collector(&tb, source.as_deref());
    Ok(())
}

/// 设置原始数据收集器容量 (字节, source = 字节设备节点 id)
#[tauri::command]
pub async fn set_rawdata_buffer_capacity(
    state: State<'_, AppState>,
    source: String,
    capacity: usize,
) -> Result<()> {
    let tb = control_api::Toolbox::from_state(state.inner());
    data::set_rawdata_buffer_capacity(&tb, &source, capacity);
    Ok(())
}

/// 设置 CAN 帧缓冲区最大帧数
#[tauri::command]
pub async fn set_can_buffer_capacity(state: State<'_, AppState>, capacity: usize) -> Result<()> {
    let tb = control_api::Toolbox::from_state(state.inner());
    data::set_can_buffer_capacity(&tb, capacity);
    Ok(())
}

/// 设置逻辑采样缓冲区最大采样数
#[tauri::command]
pub async fn set_logic_buffer_capacity(state: State<'_, AppState>, capacity: usize) -> Result<()> {
    let tb = control_api::Toolbox::from_state(state.inner());
    data::set_logic_buffer_capacity(&tb, capacity);
    Ok(())
}
