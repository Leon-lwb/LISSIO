//! 录制会话 Tauri 命令 — 薄壳
//!
//! 会话生命周期 / 查询 / 导出的实现在 [`control_api::recording`] (运行态门控、
//! 阻塞线程调度、错误文案均与 MCP/CLI 共用); 本模块只保留 IPC 签名与
//! 存储设置 (依赖 GUI 组合根的配置目录解析)。

use std::path::PathBuf;

use control_api::Toolbox;
use tauri::{Manager, State};

use crate::AppState;

/// 与 background.rs::start_recording 的数据库文件名保持一致
const RECORDING_DATABASE_FILE: &str = "acquisition.duckdb";

/// 暂停时新建录制会话并使其成为当前写入目标;被替换的会话标记为已停止
#[tauri::command]
pub async fn create_recording_session(
    state: State<'_, AppState>,
) -> Result<control_api::recording::SessionInfo, String> {
    let tb = Toolbox::from_state(state.inner());
    control_api::recording::create_session(&tb).await
}

/// 暂停时把写入目标切换到指定的已停止会话(继续写入该表)
#[tauri::command]
pub async fn set_active_recording_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<control_api::recording::SessionInfo, String> {
    let tb = Toolbox::from_state(state.inner());
    control_api::recording::switch_session(&tb, &session_id).await
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
    let state = state.inner();
    if state.data_plane.eval.execution.snapshot().state == app::RunState::Running {
        return Err(
            "recording storage settings can only be applied while the run is paused or stopped"
                .into(),
        );
    }
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
    let recording_hub = state.eval_state().recording;
    tokio::task::spawn_blocking(move || {
        recording_hub
            .apply_settings(
                Some(path),
                continue_empty_session,
                control_api::recording::SessionState::Paused,
            )
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn get_recording_health(state: State<'_, AppState>) -> control_api::recording::RecordingHealth {
    state.eval_state().recording.health()
}

#[tauri::command]
pub async fn list_recording_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<control_api::recording::SessionInfo>, String> {
    let tb = Toolbox::from_state(state.inner());
    control_api::recording::list_sessions(&tb).await
}

#[tauri::command]
pub async fn list_recording_session_summaries(
    state: State<'_, AppState>,
) -> Result<Vec<control_api::recording::SessionSummary>, String> {
    let tb = Toolbox::from_state(state.inner());
    control_api::recording::list_session_summaries(&tb).await
}

#[tauri::command]
pub async fn list_recording_bindings(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<control_api::recording::BindingInfo>, String> {
    let tb = Toolbox::from_state(state.inner());
    control_api::recording::list_bindings(&tb, &session_id).await
}

#[tauri::command]
pub async fn get_recording_database_info(
    state: State<'_, AppState>,
) -> Result<control_api::recording::RecordingDatabaseInfo, String> {
    let tb = Toolbox::from_state(state.inner());
    control_api::recording::database_info(&tb).await
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
) -> Result<control_api::recording::HistoryPage, String> {
    let tb = Toolbox::from_state(state.inner());
    control_api::recording::history_page(
        &tb,
        control_api::recording::HistoryQuery {
            session_id,
            binding_id,
            after_row_id: after_row_id.unwrap_or_default(),
            from_us,
            to_us,
            limit: limit.unwrap_or(500),
            include_payload: include_payload.unwrap_or(false),
        },
    )
    .await
}

#[tauri::command]
pub async fn query_recording_sql(
    state: State<'_, AppState>,
    query_id: String,
    sql: String,
    max_rows: Option<usize>,
) -> Result<control_api::recording::SqlResult, String> {
    let tb = Toolbox::from_state(state.inner());
    control_api::recording::query_sql(&tb, &query_id, &sql, max_rows.unwrap_or(10_000)).await
}

#[tauri::command]
pub fn cancel_recording_query(state: State<'_, AppState>, query_id: String) -> bool {
    let tb = Toolbox::from_state(state.inner());
    control_api::recording::cancel_query(&tb, &query_id)
}

#[tauri::command]
pub async fn flush_recording(state: State<'_, AppState>) -> Result<(), String> {
    let tb = Toolbox::from_state(state.inner());
    control_api::recording::flush(&tb).await
}

#[tauri::command]
pub async fn delete_recording_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let tb = Toolbox::from_state(state.inner());
    control_api::recording::delete_session(&tb, &session_id).await
}

#[tauri::command]
pub async fn cleanup_recording_sessions(
    state: State<'_, AppState>,
    policy: control_api::recording::RecordingCleanupPolicy,
) -> Result<control_api::recording::RecordingCleanupResult, String> {
    let tb = Toolbox::from_state(state.inner());
    control_api::recording::cleanup_sessions(&tb, policy).await
}

#[tauri::command]
pub async fn export_recording_data(
    state: State<'_, AppState>,
    request: control_api::recording::RecordingExportRequest,
) -> Result<control_api::recording::RecordingExportResult, String> {
    let tb = Toolbox::from_state(state.inner());
    control_api::recording::export_data(&tb, request).await
}
