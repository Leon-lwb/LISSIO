//! 后端控制工具 — 设备端点开闭 / 点位读写 / 工作区运行控制。
//!
//! MCP 工具与 CLI 子命令共用同一份实现: 打开/关闭设备会话的编排在
//! [`app::open_device_session`] / [`app::close_device_session`], 运行切换在
//! [`app::apply_workspace_run`], 本模块只做参数包装与 JSON 映射。

use app::RunAction;
use data_model::device_tree::NodeId;
use events::{BackendEventSink, EventSinkHandle};
use serde_json::{Value, json};

use crate::toolbox::Toolbox;

/// 列出全部已打开端点快照。
pub fn list_endpoints(tb: &Toolbox) -> Value {
    json!({ "nodes": tb.transport.snapshots() })
}

/// 列出生产设备树节点快照。
pub fn list_device_tree_nodes(tb: &Toolbox) -> Value {
    tb.transport.device_tree_nodes()
}

/// 列出生产设备树驱动 manifest。
pub fn list_driver_manifests(tb: &Toolbox) -> Value {
    tb.transport.driver_manifests()
}

/// 按图中设备树节点 id 打开采集子树。
pub async fn open_endpoint(
    tb: &Toolbox,
    sink: &EventSinkHandle,
    node_id: &str,
) -> Result<Value, String> {
    let spec = tb
        .data_plane
        .global_nodes
        .lock()
        .get(node_id)
        .and_then(|n| match &n.kind {
            kind::NodeKind::Acquisition { node, .. } => Some(node.clone()),
            _ => None,
        })
        .ok_or_else(|| format!("设备节点不存在: {node_id}"))?;
    let snapshot = app::open_device_session(&tb.transport, &tb.data_plane, sink, spec).await?;
    serde_json::to_value(snapshot).map_err(|e| e.to_string())
}

/// 关闭采集节点子树。
pub async fn close_endpoint(
    tb: &Toolbox,
    sink: &dyn BackendEventSink,
    node_id: &str,
) -> Result<Value, String> {
    let node_id = NodeId::new(node_id).map_err(|error| error.to_string())?;
    app::close_device_session(&tb.transport, &tb.data_plane, sink, &node_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "nodeId": node_id.to_string() }))
}

/// 工作区运行控制 (start / pause / stop) — 返回 `{state, epoch}` 并广播事件。
pub async fn run_workspace(
    tb: &Toolbox,
    sink: &dyn BackendEventSink,
    action: RunAction,
) -> Result<Value, String> {
    let snapshot =
        app::apply_workspace_run(&tb.transport, &tb.data_plane, &tb.stream_groups, action).await;
    events::emit_workspace_run(sink, &snapshot);
    serde_json::to_value(snapshot).map_err(|e| e.to_string())
}

/// 读取采集节点点位值。
pub async fn read_points(
    tb: &Toolbox,
    node_id: &str,
    point_ids: Vec<points::PointId>,
) -> Result<Value, String> {
    let result = tb
        .transport
        .read(
            &NodeId::new(node_id).map_err(|error| error.to_string())?,
            point_ids,
        )
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

/// 写入采集节点点位值。
pub async fn write_points(
    tb: &Toolbox,
    node_id: &str,
    request: points::WriteRequest,
) -> Result<Value, String> {
    let result = tb
        .transport
        .write(
            &NodeId::new(node_id).map_err(|error| error.to_string())?,
            request,
        )
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}
