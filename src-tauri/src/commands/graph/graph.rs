//! 节点图 Tauri 命令 — 薄适配层
//!
//! 提交/求值核心在 [`graph_ops`] (L3 应用核心); 本模块只做参数反序列化、
//! `State` 借用与命令注册。

use app::DecoderFeedCache;
use app::{byte_router, frame_dispatch};
use app::{AppState, Position};
use buffer_graph::Edge;
use data_model::Result;
use graph_ops::{apply_document, apply_remove_tab_graph, GraphDerived};
use std::collections::HashMap;
use tauri::{AppHandle, State};

/// 更新指定 tab 的节点图 (整体替换 nodes + edges)
///
/// 两层编译: 本 tab 数值图 + 全局字节平面; 任一层编译失败返回真实编译错误,
/// 旧图与旧平面保留。提交成功后 emit `graph:derived` 与 `graph:source` 事件。
/// 详见 [`graph_ops::apply_tab_graph`]。
#[allow(clippy::implicit_hasher)]
#[tauri::command]
pub async fn update_tab_graph(
    state: State<'_, AppState>,
    app: AppHandle,
    tab_id: String,
    documents: Vec<kind::document::NodeDocument>,
    edges: Vec<Edge>,
    base_version: Option<u64>,
) -> Result<GraphDerived> {
    apply_document(
        &state.graphs,
        &state.graphs_version,
        &state.data_plane,
        &state.source_graphs,
        &state.workspace,
        Some(&app),
        tab_id,
        documents,
        edges,
        base_version,
    )
    .await
}

/// 移除指定 tab 的节点图 (tab 删除时调用)
#[tauri::command]
pub async fn remove_tab_graph(
    state: State<'_, AppState>,
    app: AppHandle,
    tab_id: String,
) -> Result<GraphDerived> {
    apply_remove_tab_graph(&state, Some(&app), &tab_id).await
}

/// 设置输入控件当前值 (Knob/Slider/Button/Radio/Checkbox 拖动时调用)
///
/// 该值会在下一帧 evaluate 时作为 Input 节点的输出
///
/// 立即快照评估一次: 输入控件的值变化必须即时反映到图输出,
/// 不能依赖 transport 数据流 — 断开/无帧时下游 (CommandSender onChange 发送、
/// Gauge 等显示控件) 也要能感知变化。
#[tauri::command]
pub async fn set_input_value(
    state: State<'_, AppState>,
    widget_id: String,
    value: f32,
) -> Result<()> {
    state.input_values.write().insert(widget_id, value);
    frame_dispatch::refresh_snapshot(&state.data_plane);
    Ok(())
}

/// 上报节点画布布局 (拖拽或缩放结束时批量提交) — 轻量路径，不触发编译。
/// 布局直接写回节点文档，不维护第二份位置索引。
#[allow(clippy::implicit_hasher)]
#[tauri::command]
pub fn set_node_positions(
    state: State<'_, AppState>,
    positions: HashMap<String, Position>,
) -> Result<()> {
    for graph in state.source_graphs.lock().values_mut() {
        for doc in &mut graph.documents {
            if let Some(position) = positions.get(&doc.id) {
                if !position.x.is_finite() || !position.y.is_finite() {
                    continue;
                }
                doc.layout = kind::document::NodeLayout {
                    x: position.x,
                    y: position.y,
                    width: position.width,
                    height: position.height,
                };
            }
        }
    }
    state.workspace.lock().dirty = true;
    Ok(())
}

/// 提交 Custom widget 的输出 (前端 iframe 调用 ctx.send 后回传)
///
/// 后端在下一帧 evaluate 时使用这些值作为 Custom 节点的输出
/// (同 set_input_value: 立即快照评估, 不依赖 transport 数据流)
#[allow(clippy::implicit_hasher)]
#[tauri::command]
pub async fn submit_custom_output(
    state: State<'_, AppState>,
    widget_id: String,
    outputs: std::collections::HashMap<String, f32>,
) -> Result<()> {
    state.custom_outputs.write().insert(widget_id, outputs);
    frame_dispatch::refresh_snapshot(&state.data_plane);
    Ok(())
}

/// 提交字符串输出 — 保留给 Custom JS widget 的字符串输出回传通道
///
/// (Trigger 的字符串规则已由后端图求值直接产出, 不再走此命令;
///  当前前端尚无调用方)
///
/// 写入 `custom_text_outputs` map; 后端 `text_output_ticker` 自适应速率推送给
/// 订阅了 `subscribe_string_outputs` 的前端 (TextDisplay 控件读取显示)
#[allow(clippy::implicit_hasher)]
#[tauri::command]
pub async fn submit_custom_text_output(
    state: State<'_, AppState>,
    widget_id: String,
    outputs: std::collections::HashMap<String, String>,
) -> Result<()> {
    state.custom_text_outputs.lock().insert(widget_id, outputs);
    Ok(())
}

/// 字节注入 — CommandSender 回环模式 / 协议调试的发送路径
/// (取代旧 inject_loopback_bytes: loopback 字符串特判 → 全局 BytePlan 路由)
///
/// 将字节沿全局 BytePlan 中 `source_node_id` 的下游字节边路由:
/// - FrameDecoder.in: 喂入解析 (与实时 RX 同等对待: 更新 last_frame + 旁路收集)
/// - Protocol.in: 喂入协议引擎 (产帧进 source_frames + 触发数值平面)
/// - Transport.tx: 经传输注册表发送 (回注落地)
///
/// 与串口开关无关 — 无连接时也能工作 (路由不依赖 transport 状态)。
///
/// 返回: 路由命中的下游数量 (0 = 未连线, 前端可忽略)
#[tauri::command]
pub async fn inject_bytes(
    app: AppHandle,
    state: State<'_, AppState>,
    source_node_id: String,
    data: Vec<u8>,
) -> Result<usize> {
    let plane = state.data_plane.clone();
    let target_count = plane.byte_plan.lock().routes_for(&source_node_id).len();

    let mut cache = DecoderFeedCache::new();
    let summary = byte_router::route_bytes(
        &plane,
        Some(&app),
        &source_node_id,
        &data,
        0,
        &mut cache,
        None,
    )
    .await;

    // FrameDecoder 被喂入 → 快照评估一次 (decoder 输出来自 last_frame 缓存)
    if summary.decoders_fed {
        frame_dispatch::refresh_snapshot(&plane);
    }

    Ok(target_count)
}
