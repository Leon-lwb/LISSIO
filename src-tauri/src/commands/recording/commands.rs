use std::path::PathBuf;

use app::{AppState, RunState};
use recording::{
    BindingInfo, HistoryPage, HistoryQuery, RecordingCleanupPolicy, RecordingCleanupResult,
    RecordingDatabaseInfo, RecordingExportRequest, RecordingExportResult, RecordingHealth,
    SessionInfo, SessionState, SessionSummary, SqlResult,
};
use tauri::{Manager, State};

/// 与 background.rs::start_recording 的数据库文件名保持一致
const RECORDING_DATABASE_FILE: &str = "acquisition.duckdb";

/// 录制会话生命周期操作仅在运行暂停时开放 — 暂停期间管道不喂数据,切换写入目标不丢批次
fn require_paused_run(state: &AppState) -> Result<(), String> {
    if state.data_plane.eval.execution.snapshot().state == RunState::Paused {
        return Ok(());
    }
    Err("recording sessions can only be created or switched while the run is paused".into())
}

/// 录制存储设置 (位置/续写开关) 在暂停与停止时均可应用 — 两种状态下管道都不产批次;
/// 设置回放发生在启动早期 (此时运行状态为 stopped)
fn require_not_running(state: &AppState) -> Result<(), String> {
    if state.data_plane.eval.execution.snapshot().state == RunState::Running {
        return Err(
            "recording storage settings can only be applied while the run is paused or stopped"
                .into(),
        );
    }
    Ok(())
}

/// 暂停时新建录制会话并使其成为当前写入目标;被替换的会话标记为已停止
#[tauri::command]
pub async fn create_recording_session(state: State<'_, AppState>) -> Result<SessionInfo, String> {
    require_paused_run(state.inner())?;
    let recording = state.eval_state().recording;
    tokio::task::spawn_blocking(move || {
        recording
            .create_session(SessionState::Paused)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// 暂停时把写入目标切换到指定的已停止会话(继续写入该表)
#[tauri::command]
pub async fn set_active_recording_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SessionInfo, String> {
    require_paused_run(state.inner())?;
    let recording = state.eval_state().recording;
    tokio::task::spawn_blocking(move || {
        recording
            .switch_session(&session_id, SessionState::Paused)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// 应用录制存储设置 — 数据库目录与空会话续写开关; 空目录回落到默认位置
/// (app config dir 下的 recordings/)。运行中拒绝, 下次启动设置回放时生效。
#[tauri::command]
pub async fn apply_recording_settings(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    database_dir: Option<String>,
    continue_empty_session: bool,
) -> Result<(), String> {
    require_not_running(state.inner())?;
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let path = database_dir
        .as_deref()
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
        .map_or_else(
            || config_dir.join("recordings").join(RECORDING_DATABASE_FILE),
            |dir| PathBuf::from(dir).join(RECORDING_DATABASE_FILE),
        );
    let recording = state.eval_state().recording;
    tokio::task::spawn_blocking(move || {
        recording
            .apply_settings(Some(path), continue_empty_session, SessionState::Paused)
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

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
