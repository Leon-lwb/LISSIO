//! 传输/协议命令壳 — 命令体在 [`app::transport_ops`] / [`app::protocol_ops`] (L3)

use app::AppState;
use can::{CanFrame, CanFrameBatch, CandleDeviceInfo};
use data_model::{PortInfo, Result, TestDataConfig, TransportConfig, WidgetBinding};
use schema_types::{ProtocolConfig, ProtocolSchema};
use tauri::{AppHandle, State};

/// 列出所有可用串口
#[tauri::command]
pub async fn list_ports() -> Result<Vec<PortInfo>> {
    serial::serial::list_ports()
}

/// 打开传输连接 (node_id = 图中 Transport 节点 id)
///
/// `protocol` 与 `schema` 仅被 TestData 用作生成数据的线缆格式参考, 其他传输类型忽略。
/// 成功后挂载数据平面读任务 (subscribe → 字节路由 → 数值平面)。
#[tauri::command]
pub async fn open_transport(
    app: AppHandle,
    state: State<'_, AppState>,
    node_id: String,
    config: TransportConfig,
    protocol: ProtocolConfig,
    schema: Option<ProtocolSchema>,
) -> Result<()> {
    state
        .open_transport(&app, &node_id, config, protocol, schema)
        .await
}

/// 关闭传输连接 (node_id = 图中 Transport 节点 id)
#[tauri::command]
pub async fn close_transport(
    app: AppHandle,
    state: State<'_, AppState>,
    node_id: String,
) -> Result<()> {
    state.close_transport(&app, &node_id).await
}

/// 发送原始字节 (node_id = 目标 Transport 节点 id)
#[tauri::command]
pub async fn send_raw(state: State<'_, AppState>, node_id: String, data: Vec<u8>) -> Result<()> {
    state.send_raw(&node_id, data).await
}

/// 发送字符串 (node_id = 目标 Transport 节点 id)
#[tauri::command]
pub async fn send_string(state: State<'_, AppState>, node_id: String, text: String) -> Result<()> {
    send_raw(state, node_id, text.into_bytes()).await
}

/// TextOut 手动发送 — 立即把 textout 节点当前图内文本发往其目标 Transport
#[tauri::command]
pub async fn send_text_out_now(state: State<'_, AppState>, node_id: String) -> Result<()> {
    state.send_text_out_now(&node_id).await
}

/// 发送控件值 (根据绑定模式自动编码)
#[tauri::command]
pub async fn send_widget_value(
    state: State<'_, AppState>,
    node_id: String,
    protocol_node: Option<String>,
    binding: WidgetBinding,
    value: f32,
) -> Result<()> {
    state
        .send_widget_value(&node_id, protocol_node, binding, value)
        .await
}

/// 设置指定 Protocol 节点的协议配置 (运行时覆盖, 重建解析引擎; TestData 自动断连)
#[tauri::command]
pub async fn set_protocol(
    app: AppHandle,
    state: State<'_, AppState>,
    node_id: String,
    config: ProtocolConfig,
) -> Result<()> {
    state.set_protocol(&app, &node_id, config).await
}

/// 获取指定 Protocol 节点的当前协议配置
#[tauri::command]
pub async fn get_protocol(state: State<'_, AppState>, node_id: String) -> Result<ProtocolConfig> {
    state.get_protocol(&node_id).await
}

/// 获取自动检测到的通道数 (仅在自动模式下返回 Some, 手动模式返回 None)
#[tauri::command]
pub async fn get_detected_channels(
    state: State<'_, AppState>,
    node_id: String,
) -> Result<Option<usize>> {
    state.get_detected_channels(&node_id).await
}

/// 运行时热更新传输节点的链路配置 (图连接/协议配置变化后由前端推送)
#[tauri::command]
pub async fn update_transport_protocol(
    state: State<'_, AppState>,
    node_id: String,
    protocol: ProtocolConfig,
    schema: Option<ProtocolSchema>,
    test_data_config: Option<TestDataConfig>,
) -> Result<()> {
    state
        .update_transport_protocol(&node_id, protocol, schema, test_data_config)
        .await
}

/// 发送 CAN 帧 (经指定/溯源 Protocol 节点引擎编码后写入目标 Transport)
#[tauri::command]
pub async fn send_can_frame(
    state: State<'_, AppState>,
    node_id: String,
    protocol_node: Option<String>,
    frame: CanFrame,
) -> Result<()> {
    state.send_can_frame(&node_id, protocol_node, frame).await
}

/// 同步查询: 获取最近 N 个 CAN 帧
///
/// 返回 `CanFrameBatch` (与订阅路径同构) — 前端 `getRecentCanFrames` 直接
/// 作为首屏快照灌入 buffer sink, 不需要再做结构转换。`seq: 0` 表示"非流式",
/// 下游收到后会立即消费, 后续若切换到订阅模式, 增量流从 seq=1 开始。
#[tauri::command]
pub async fn get_recent_can_frames(
    state: State<'_, AppState>,
    count: usize,
) -> Result<CanFrameBatch> {
    let frames = state.can_buffer.lock().get_recent(count);
    Ok(CanFrameBatch { seq: 0, frames })
}

/// 清空 CAN 帧缓冲区
#[tauri::command]
pub async fn clear_can_buffer(state: State<'_, AppState>) -> Result<()> {
    state.can_buffer.lock().clear();
    Ok(())
}

/// 获取 CAN 缓冲区当前帧数
#[tauri::command]
pub async fn get_can_buffer_info(state: State<'_, AppState>) -> Result<usize> {
    Ok(state.can_buffer.lock().len())
}

/// 协议回环：发送字节并立即捕获协议引擎解析结果 (调试用, 即时同步解析)
#[tauri::command]
pub async fn send_and_capture(
    state: State<'_, AppState>,
    node_id: String,
    protocol_node: String,
    data: Vec<u8>,
) -> Result<app::LoopbackResult> {
    state.send_and_capture(&node_id, &protocol_node, data).await
}

/// 列出所有 candleLight 设备
#[tauri::command]
pub async fn list_candle_devices() -> Result<Vec<CandleDeviceInfo>> {
    can_transport::candle::list_devices()
}
