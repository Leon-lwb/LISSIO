//! 后端控制工具 — 设备端点开闭 / 点位读写 / 工作区运行控制。
//!
//! MCP 工具与 CLI 子命令共用同一份实现: 打开/关闭设备会话的编排在
//! [`app::open_device_session`] / [`app::close_device_session`], 运行切换在
//! [`app::apply_workspace_run`], 本模块只做参数包装与 JSON 映射。

use app::RunAction;
use events::{BackendEventSink, EventSinkHandle};
use serde_json::{Value, json};

use crate::toolbox::Toolbox;

/// 列出全部已打开端点快照。
pub fn list_endpoints(tb: &Toolbox) -> Value {
    json!({ "endpoints": tb.transport.snapshots() })
}

/// 按图中设备节点 id 打开端点 (读取节点内 EndpointSpec)。
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
            kind::NodeKind::Acquisition { spec, .. } => Some(spec.clone()),
            _ => None,
        })
        .ok_or_else(|| format!("设备节点不存在: {node_id}"))?;
    let snapshot = app::open_device_session(&tb.transport, &tb.data_plane, sink, spec).await?;
    serde_json::to_value(snapshot).map_err(|e| e.to_string())
}

/// 关闭端点 (endpoint_id = 图中设备节点 id)。
pub async fn close_endpoint(
    tb: &Toolbox,
    sink: &dyn BackendEventSink,
    endpoint_id: &str,
) -> Result<Value, String> {
    app::close_device_session(&tb.transport, &tb.data_plane, sink, endpoint_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!({ "ok": true, "endpoint_id": endpoint_id }))
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

/// 读取端点点位值。
pub async fn read_points(
    tb: &Toolbox,
    endpoint_id: &str,
    point_ids: Vec<points::PointId>,
) -> Result<Value, String> {
    let result = tb
        .transport
        .read(
            &data_model::device::EndpointId(endpoint_id.to_string()),
            point_ids,
        )
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

/// 写入端点点位值。
pub async fn write_points(
    tb: &Toolbox,
    endpoint_id: &str,
    request: points::WriteRequest,
) -> Result<Value, String> {
    let result = tb
        .transport
        .write(
            &data_model::device::EndpointId(endpoint_id.to_string()),
            request,
        )
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}
