use app::AppState;
use recording::{
    BindingInfo, HistoryPage, HistoryQuery, RecordingCleanupPolicy, RecordingCleanupResult,
    RecordingDatabaseInfo, RecordingExportRequest, RecordingExportResult, RecordingHealth,
    SessionInfo, SessionSummary, SqlResult,
};
use tauri::State;

#[tauri::command]
pub fn get_recording_health(state: State<'_, AppState>) -> RecordingHealth {
    state.eval_state().recording.health()
}

#[tauri::command]
pub async fn list_recording_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<SessionInfo>, String> {
    let store = state
        .eval_state()
        .recording
        .store()
        .ok_or_else(|| "recording store is unavailable".to_string())?;
    tokio::task::spawn_blocking(move || store.list_sessions().map_err(|error| error.to_string()))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_recording_session_summaries(
    state: State<'_, AppState>,
) -> Result<Vec<SessionSummary>, String> {
    let recording = state.eval_state().recording;
    tokio::task::spawn_blocking(move || {
        recording
            .list_session_summaries()
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_recording_bindings(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<BindingInfo>, String> {
    let recording = state.eval_state().recording;
    tokio::task::spawn_blocking(move || {
        recording
            .list_bindings(&session_id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_recording_database_info(
    state: State<'_, AppState>,
) -> Result<RecordingDatabaseInfo, String> {
    let recording = state.eval_state().recording;
    tokio::task::spawn_blocking(move || {
        recording.database_info().map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn query_recording_history(
    state: State<'_, AppState>,
    session_id: String,
    binding_id: Option<String>,
    after_row_id: Option<i64>,
    from_us: Option<u64>,
    to_us: Option<u64>,
    limit: Option<usize>,
    include_payload: Option<bool>,
) -> Result<HistoryPage, String> {
    let store = state
        .eval_state()
        .recording
        .store()
        .ok_or_else(|| "recording store is unavailable".to_string())?;
    tokio::task::spawn_blocking(move || {
        store
            .history_page_query(&HistoryQuery {
                session_id,
                binding_id,
                after_row_id: after_row_id.unwrap_or_default(),
                from_us,
                to_us,
                limit: limit.unwrap_or(500),
                include_payload: include_payload.unwrap_or(false),
            })
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn query_recording_sql(
    state: State<'_, AppState>,
    query_id: String,
    sql: String,
    max_rows: Option<usize>,
) -> Result<SqlResult, String> {
    let recording = state.eval_state().recording;
    tokio::task::spawn_blocking(move || {
        recording
            .query_sql(&query_id, &sql, max_rows.unwrap_or(10_000))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn cancel_recording_query(state: State<'_, AppState>, query_id: String) -> bool {
    state.eval_state().recording.cancel_query(&query_id)
}

#[tauri::command]
pub async fn flush_recording(state: State<'_, AppState>) -> Result<(), String> {
    let recording = state.eval_state().recording;
    tokio::task::spawn_blocking(move || recording.flush().map_err(|error| error.to_string()))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn delete_recording_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let recording = state.eval_state().recording;
    tokio::task::spawn_blocking(move || {
        recording
            .delete_session(&session_id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn cleanup_recording_sessions(
    state: State<'_, AppState>,
    policy: RecordingCleanupPolicy,
) -> Result<RecordingCleanupResult, String> {
    let recording = state.eval_state().recording;
    tokio::task::spawn_blocking(move || {
        recording
            .cleanup_sessions(policy)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn export_recording_data(
    state: State<'_, AppState>,
    request: RecordingExportRequest,
) -> Result<RecordingExportResult, String> {
    let store = state
        .eval_state()
        .recording
        .store()
        .ok_or_else(|| "recording store is unavailable".to_string())?;
    tokio::task::spawn_blocking(move || {
        recording::export_recording_data(&store, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
