//! 采集端点与点位 — endpoint list/open/close/read/write。

use control_api::control;
use serde_json::Value;

use super::EndpointAction;
use crate::Host;

/// 端点与点位命令分发。
pub async fn endpoint(host: &Host, action: &EndpointAction) -> Result<Value, String> {
    let tb = &host.toolbox;
    match action {
        EndpointAction::List => Ok(control::list_endpoints(tb)),
        EndpointAction::Open { node_id } => control::open_endpoint(tb, &host.sink, node_id).await,
        EndpointAction::Close { node_id } => {
            control::close_endpoint(tb, host.sink.as_ref(), node_id).await
        }
        EndpointAction::Read { node_id, point_ids } => {
            let ids = point_ids
                .split(',')
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(|id| points::PointId(id.to_string()))
                .collect::<Vec<_>>();
            control::read_points(tb, node_id, ids).await
        }
        EndpointAction::Write {
            node_id,
            request_file,
        } => {
            let value = crate::read_json_file(request_file)?;
            let request: points::WriteRequest = serde_json::from_value(value)
                .map_err(|error| format!("WriteRequest JSON 不符: {error}"))?;
            control::write_points(tb, node_id, request).await
        }
    }
}
