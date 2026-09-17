//! 采集适配器能力面 — 适配器列举 / 点位描述 / 端点开闭 / 点位读写。
//!
//! 全部委托 `AppState::transport` (采集运行时), 与桌面 IPC 的
//! `commands/acquisition` 是同一份实现。

use acquisition::SubscriptionIntent;
use backend_host::BackendHost;
use data_model::device::{DriverId, DriverPayload, EndpointId};
use points::{PointId, WriteRequest};
use serde_json::Value;

use crate::args::{RpcError, domain, encode, required, text};

/// 列出全部已注册适配器的能力卡片。
pub fn list_adapter_capabilities(host: &BackendHost) -> Result<Value, RpcError> {
    encode(&host.state.transport.adapter_capabilities())
}

/// 列出全部已打开端点快照。
pub fn list_acquisition_endpoints(host: &BackendHost) -> Result<Value, RpcError> {
    encode(&host.state.transport.snapshots())
}

/// 描述指定适配器配置下的点位表。
pub fn describe_acquisition_points(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let payload: DriverPayload = required(args, cmd, "payload")?;
    text(
        host.state
            .transport
            .descriptors(&payload)
            .map_err(|e| e.to_string()),
    )
}

/// 发现指定适配器的可用端点。
pub fn discover_acquisition_endpoints(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let adapter_id: String = required(args, cmd, "adapter_id")?;
    text(
        host.state
            .transport
            .discover(&DriverId(adapter_id))
            .map_err(|error| error.to_string()),
    )
}

/// 校验并归一化适配器配置。
pub fn validate_adapter_configuration(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let payload: DriverPayload = required(args, cmd, "payload")?;
    text(
        host.state
            .transport
            .validate(payload)
            .map_err(|error| error.to_string()),
    )
}

/// 读取单个端点的最新点位样本。
pub fn latest_acquisition_samples(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let endpoint_id: String = required(args, cmd, "endpoint_id")?;
    text(
        host.state
            .transport
            .latest_samples(&EndpointId(endpoint_id))
            .map_err(|error| error.to_string()),
    )
}

/// 按图中设备节点 id 打开采集端点。
pub async fn open_acquisition_endpoint(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let node_id: String = required(args, cmd, "node_id")?;
    let spec = host
        .state
        .data_plane
        .global_nodes
        .lock()
        .get(&node_id)
        .and_then(|node| match &node.kind {
            kind::NodeKind::Acquisition { spec, .. } => Some(spec.clone()),
            _ => None,
        })
        .ok_or_else(|| RpcError::text("device node does not exist"))?;
    text(host.state.open_device(&host.sink, spec).await)
}

/// 关闭采集端点。
pub async fn close_acquisition_endpoint(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let endpoint_id: String = required(args, cmd, "endpoint_id")?;
    domain(
        host.state
            .close_transport(host.sink.as_ref(), &endpoint_id)
            .await,
    )
}

/// 读取端点点位值。
pub async fn read_acquisition_points(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let endpoint_id: String = required(args, cmd, "endpoint_id")?;
    let point_ids: Vec<PointId> = required(args, cmd, "point_ids")?;
    text(
        host.state
            .transport
            .read(&EndpointId(endpoint_id), point_ids)
            .await
            .map_err(|error| error.to_string()),
    )
}

/// 订阅端点点位 (返回生效订阅)。
pub async fn subscribe_acquisition_points(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let endpoint_id: String = required(args, cmd, "endpoint_id")?;
    let intent: SubscriptionIntent = required(args, cmd, "intent")?;
    text(
        host.state
            .transport
            .subscribe(&EndpointId(endpoint_id), intent)
            .await
            .map_err(|error| error.to_string()),
    )
}

/// 写入端点点位值。
pub async fn write_acquisition_points(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let endpoint_id: String = required(args, cmd, "endpoint_id")?;
    let request: WriteRequest = required(args, cmd, "request")?;
    text(
        host.state
            .transport
            .write(&EndpointId(endpoint_id), request)
            .await
            .map_err(|error| error.to_string()),
    )
}
