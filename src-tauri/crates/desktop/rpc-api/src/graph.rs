//! 节点图与工作区 — 图提交 / 拓扑 op / 画布布局 / 工作区水合。
//!
//! 编译与提交核心在 `graph_ops` (L3), 本模块只做参数解包与事件端口注入;
//! 与桌面 IPC 的 `commands/graph` 是同一份实现。

use std::collections::HashMap;

use app::{AppState, DecoderFeedCache, Position, byte_router, frame_dispatch};
use backend_host::BackendHost;
use buffer_graph::Edge;
use graph_ops::{
    GraphSourceEvent, apply_connect_edge, apply_disconnect_edge, apply_document,
    apply_remove_tab_graph,
};
use kind::document::{NodeDocument, NodeLayout};
use serde_json::Value;

use crate::args::{RpcError, domain, encode, ok, optional, required};

/// 状态句柄的公共前缀 — 缩短每条命令的状态借用。
const fn state(host: &BackendHost) -> &AppState {
    &host.state
}

/// 整体替换指定 tab 的节点图 (两层编译: 本 tab 数值图 + 全局字节平面)。
pub async fn update_tab_graph(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let tab_id: String = required(args, cmd, "tab_id")?;
    let documents: Vec<NodeDocument> = required(args, cmd, "documents")?;
    let edges: Vec<Edge> = required(args, cmd, "edges")?;
    let base_version: Option<u64> = optional(args, cmd, "base_version")?;
    let state = state(host);
    domain(
        apply_document(
            &state.graphs,
            &state.graphs_version,
            &state.data_plane,
            &state.source_graphs,
            &state.workspace,
            Some(host.sink.as_ref()),
            tab_id,
            documents,
            edges,
            base_version,
        )
        .await,
    )
}

/// 移除指定 tab 的节点图 (tab 删除时调用)。
pub async fn remove_tab_graph(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let tab_id: String = required(args, cmd, "tab_id")?;
    domain(apply_remove_tab_graph(state(host), Some(host.sink.as_ref()), &tab_id).await)
}

/// 读取指定 tab 的权威源图 (无源图返回 null)。
pub fn get_source_graph(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let tab_id: String = required(args, cmd, "tab_id")?;
    let state = state(host);
    let graph = state.source_graphs.lock().get(&tab_id).cloned();
    let snapshot = graph.map(|graph| GraphSourceEvent {
        documents: graph.documents,
        tab_id,
        version: state
            .graphs_version
            .load(std::sync::atomic::Ordering::Relaxed),
        edges: graph.edges,
    });
    encode(&snapshot)
}

/// 上报节点画布布局 — 轻量路径, 不触发编译。
pub fn set_node_positions(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let positions: HashMap<String, Position> = required(args, cmd, "positions")?;
    let state = state(host);
    for graph in state.source_graphs.lock().values_mut() {
        for doc in &mut graph.documents {
            if let Some(position) = positions.get(&doc.id) {
                if !position.x.is_finite() || !position.y.is_finite() {
                    continue;
                }
                doc.layout = NodeLayout {
                    x: position.x,
                    y: position.y,
                    width: position.width,
                    height: position.height,
                };
            }
        }
    }
    state.workspace.lock().dirty = true;
    ok()
}

/// 设置输入控件当前值 — 立即快照评估一次 (不依赖数据流)。
pub fn set_input_value(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let widget_id: String = required(args, cmd, "widget_id")?;
    let value: f32 = required(args, cmd, "value")?;
    let state = state(host);
    state.input_values.write().insert(widget_id, value);
    frame_dispatch::refresh_snapshot(&state.data_plane);
    ok()
}

/// 提交 Custom widget 的数值输出。
pub fn submit_custom_output(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let widget_id: String = required(args, cmd, "widget_id")?;
    let outputs: HashMap<String, f32> = required(args, cmd, "outputs")?;
    let state = state(host);
    state.custom_outputs.write().insert(widget_id, outputs);
    frame_dispatch::refresh_snapshot(&state.data_plane);
    ok()
}

/// 提交 Custom widget 的字符串输出 (TextDisplay 推送通道)。
pub fn submit_custom_text_output(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let widget_id: String = required(args, cmd, "widget_id")?;
    let outputs: HashMap<String, String> = required(args, cmd, "outputs")?;
    state(host)
        .custom_text_outputs
        .lock()
        .insert(widget_id, outputs);
    ok()
}

/// 字节注入 — 沿全局 BytePlan 把字节路由到下游字节边。
pub async fn inject_bytes(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let source_node_id: String = required(args, cmd, "source_node_id")?;
    let data: Vec<u8> = required(args, cmd, "data")?;
    let plane = state(host).data_plane.clone();
    let target_count = plane.byte_plan.lock().routes_for(&source_node_id).len();

    let mut cache = DecoderFeedCache::new();
    let summary = byte_router::route_bytes(
        &plane,
        Some(host.sink.as_ref()),
        &source_node_id,
        &data,
        0,
        &mut cache,
        None,
    )
    .await;
    if summary.decoders_fed {
        frame_dispatch::refresh_snapshot(&plane);
    }
    encode(&target_count)
}

/// 连线 — 拓扑的后端权威入口 (省略 handle 时按节点类型补默认)。
pub async fn connect_edge(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let source: String = required(args, cmd, "source")?;
    let target: String = required(args, cmd, "target")?;
    let tab_id: Option<String> = optional(args, cmd, "tab_id")?;
    let source_handle: Option<String> = optional(args, cmd, "source_handle")?;
    let target_handle: Option<String> = optional(args, cmd, "target_handle")?;
    let state = state(host);
    let derived = apply_connect_edge(
        &state.graphs,
        &state.graphs_version,
        &state.data_plane,
        &state.source_graphs,
        &state.workspace,
        Some(host.sink.as_ref()),
        tab_id,
        source,
        target,
        source_handle,
        target_handle,
    )
    .await;
    domain(derived)
}

/// 删线 — 按 edge_id 或 source/target (可只给一端) 查找删除。
pub async fn disconnect_edge(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let edge_id: Option<String> = optional(args, cmd, "edge_id")?;
    let source: Option<String> = optional(args, cmd, "source")?;
    let target: Option<String> = optional(args, cmd, "target")?;
    let state = state(host);
    let removed = apply_disconnect_edge(
        &state.graphs,
        &state.graphs_version,
        &state.data_plane,
        &state.source_graphs,
        &state.workspace,
        Some(host.sink.as_ref()),
        edge_id,
        source,
        target,
    )
    .await;
    domain(removed)
}

/// 读取工作区水合快照 (`null` = 无持久化工作区)。
pub async fn workspace_get(host: &BackendHost) -> Result<Value, RpcError> {
    encode(&app::workspace_snapshot(state(host)).await)
}

/// 提交 tab 元数据 (控件 tab + 数据面板 tab) — 整表覆盖。
pub fn workspace_set_tabs(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let tabs: Vec<app::TabMeta> = required(args, cmd, "tabs")?;
    let data_tabs: Vec<app::DataTabMeta> = required(args, cmd, "data_tabs")?;
    let mut workspace = state(host).workspace.lock();
    workspace.tabs = tabs;
    workspace.data_tabs = data_tabs;
    workspace.dirty = true;
    drop(workspace);
    ok()
}
