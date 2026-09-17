//! Thin IPC over the protocol-neutral acquisition runtime.

use acquisition::{
    AcquisitionRuntime, AdapterCapability, DiscoveredEndpoint, EffectiveSubscription,
    EndpointSnapshot, SubscriptionIntent,
};
use app::AppState;
use data_model::device::{DriverId, DriverPayload, EndpointId};
use points::{PointId, PointSample, ReadResult, WriteRequest, WriteResult};
use tauri::State;

type CommandResult<T> = Result<T, String>;

#[tauri::command]
pub fn describe_acquisition_points(
    runtime: State<'_, std::sync::Arc<AcquisitionRuntime>>,
    payload: DriverPayload,
) -> CommandResult<Vec<points::PointDescriptor>> {
    runtime.descriptors(&payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_adapter_capabilities(
    runtime: State<'_, std::sync::Arc<AcquisitionRuntime>>,
) -> Vec<AdapterCapability> {
    runtime.adapter_capabilities()
}

#[tauri::command]
pub fn discover_acquisition_endpoints(
    runtime: State<'_, std::sync::Arc<AcquisitionRuntime>>,
    adapter_id: String,
) -> CommandResult<Vec<DiscoveredEndpoint>> {
    runtime
        .discover(&DriverId(adapter_id))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn validate_adapter_configuration(
    runtime: State<'_, std::sync::Arc<AcquisitionRuntime>>,
    payload: DriverPayload,
) -> CommandResult<DriverPayload> {
    runtime.validate(payload).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_acquisition_endpoint(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    node_id: String,
) -> CommandResult<EndpointSnapshot> {
    let spec = state
        .data_plane
        .global_nodes
        .lock()
        .get(&node_id)
        .and_then(|n| match &n.kind {
            kind::NodeKind::Acquisition { spec, .. } => Some(spec.clone()),
            _ => None,
        })
        .ok_or("device node does not exist")?;
    let sink = crate::event_sink::TauriEventSink::handle(&app);
    state.open_device(&sink, spec).await
}

#[tauri::command]
pub async fn close_acquisition_endpoint(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    endpoint_id: String,
) -> CommandResult<()> {
    let sink = crate::event_sink::TauriEventSink::new(app);
    state
        .close_transport(&sink, &endpoint_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_acquisition_endpoints(
    runtime: State<'_, std::sync::Arc<AcquisitionRuntime>>,
) -> Vec<EndpointSnapshot> {
    runtime.snapshots()
}

#[tauri::command]
pub async fn read_acquisition_points(
    runtime: State<'_, std::sync::Arc<AcquisitionRuntime>>,
    endpoint_id: String,
    point_ids: Vec<PointId>,
) -> CommandResult<ReadResult> {
    runtime
        .read(&EndpointId(endpoint_id), point_ids)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn subscribe_acquisition_points(
    runtime: State<'_, std::sync::Arc<AcquisitionRuntime>>,
    endpoint_id: String,
    intent: SubscriptionIntent,
) -> CommandResult<EffectiveSubscription> {
    runtime
        .subscribe(&EndpointId(endpoint_id), intent)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn write_acquisition_points(
    runtime: State<'_, std::sync::Arc<AcquisitionRuntime>>,
    endpoint_id: String,
    request: WriteRequest,
) -> CommandResult<WriteResult> {
    runtime
        .write(&EndpointId(endpoint_id), request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn latest_acquisition_samples(
    runtime: State<'_, std::sync::Arc<AcquisitionRuntime>>,
    endpoint_id: String,
) -> CommandResult<Vec<PointSample>> {
    runtime
        .latest_samples(&EndpointId(endpoint_id))
        .map_err(|error| error.to_string())
}
