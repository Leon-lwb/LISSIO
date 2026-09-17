//! 录制会话 — 无人值守采集记录的会话生命周期 / 查询 / 导出能力。
//!
//! 实现全部委托 `recording` crate (`RecordingHub`), 本模块补充运行态门控
//! (会话创建/切换仅在暂停态开放 — 暂停期间管道不喂数据, 切换写入目标不丢
//! 批次) 与阻塞线程调度, Tauri IPC 命令与 MCP/CLI 共用同一份实现。

pub use recording::{
    BindingInfo, HistoryPage, HistoryQuery, RecordingCleanupPolicy, RecordingCleanupResult,
    RecordingDatabaseInfo, RecordingExportRequest, RecordingExportResult, RecordingHealth,
    SessionInfo, SessionState, SessionSummary, SqlResult,
};

use crate::toolbox::Toolbox;

/// 录制会话生命周期操作仅在运行暂停时开放。
fn require_paused_run(tb: &Toolbox) -> Result<(), String> {
    if tb.data_plane.eval.execution.snapshot().state == pipeline::RunState::Paused {
        return Ok(());
    }
    Err("recording sessions can only be created or switched while the run is paused".into())
}

/// 暂停时新建录制会话并使其成为当前写入目标;被替换的会话标记为已停止。
pub async fn create_session(tb: &Toolbox) -> Result<SessionInfo, String> {
    require_paused_run(tb)?;
    let recording = tb.data_plane.eval.recording.clone();
    tokio::task::spawn_blocking(move || {
        recording
            .create_session(SessionState::Paused)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// 暂停时把写入目标切换到指定的已停止会话(继续写入该表)。
pub async fn switch_session(tb: &Toolbox, session_id: &str) -> Result<SessionInfo, String> {
    require_paused_run(tb)?;
    let recording = tb.data_plane.eval.recording.clone();
    let session_id = session_id.to_string();
    tokio::task::spawn_blocking(move || {
        recording
            .switch_session(&session_id, SessionState::Paused)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// 全部录制会话 (含状态与行数)。
pub async fn list_sessions(tb: &Toolbox) -> Result<Vec<SessionInfo>, String> {
    let store = tb
        .data_plane
        .eval
        .recording
        .store()
        .ok_or_else(|| "recording store is unavailable".to_string())?;
    tokio::task::spawn_blocking(move || store.list_sessions().map_err(|error| error.to_string()))
        .await
        .map_err(|error| error.to_string())?
}

/// 会话摘要列表 (轻量, 适合列表展示)。
pub async fn list_session_summaries(tb: &Toolbox) -> Result<Vec<SessionSummary>, String> {
    let recording = tb.data_plane.eval.recording.clone();
    tokio::task::spawn_blocking(move || {
        recording
            .list_session_summaries()
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// 指定会话的通道绑定 (binding_id 是查询历史的键)。
pub async fn list_bindings(tb: &Toolbox, session_id: &str) -> Result<Vec<BindingInfo>, String> {
    let recording = tb.data_plane.eval.recording.clone();
    let session_id = session_id.to_string();
    tokio::task::spawn_blocking(move || {
        recording
            .list_bindings(&session_id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// 录制数据库信息 (路径/大小/引擎状态)。
pub async fn database_info(tb: &Toolbox) -> Result<RecordingDatabaseInfo, String> {
    let recording = tb.data_plane.eval.recording.clone();
    tokio::task::spawn_blocking(move || {
        recording.database_info().map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// 分页查询历史采样。
pub async fn history_page(tb: &Toolbox, query: HistoryQuery) -> Result<HistoryPage, String> {
    let store = tb
        .data_plane
        .eval
        .recording
        .store()
        .ok_or_else(|| "recording store is unavailable".to_string())?;
    tokio::task::spawn_blocking(move || {
        store
            .history_page_query(&query)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// 只读 SQL 查询 (query_id 用于取消)。
pub async fn query_sql(
    tb: &Toolbox,
    query_id: &str,
    sql: &str,
    max_rows: usize,
) -> Result<SqlResult, String> {
    let recording = tb.data_plane.eval.recording.clone();
    let query_id = query_id.to_string();
    let sql = sql.to_string();
    tokio::task::spawn_blocking(move || {
        recording
            .query_sql(&query_id, &sql, max_rows)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// 取消进行中的 SQL 查询。
pub fn cancel_query(tb: &Toolbox, query_id: &str) -> bool {
    tb.data_plane.eval.recording.cancel_query(query_id)
}

/// 把未落盘的批次强制刷入数据库。
pub async fn flush(tb: &Toolbox) -> Result<(), String> {
    let recording = tb.data_plane.eval.recording.clone();
    tokio::task::spawn_blocking(move || recording.flush().map_err(|error| error.to_string()))
        .await
        .map_err(|error| error.to_string())?
}

/// 删除录制会话。
pub async fn delete_session(tb: &Toolbox, session_id: &str) -> Result<(), String> {
    let recording = tb.data_plane.eval.recording.clone();
    let session_id = session_id.to_string();
    tokio::task::spawn_blocking(move || {
        recording
            .delete_session(&session_id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// 按策略批量清理历史会话。
pub async fn cleanup_sessions(
    tb: &Toolbox,
    policy: RecordingCleanupPolicy,
) -> Result<RecordingCleanupResult, String> {
    let recording = tb.data_plane.eval.recording.clone();
    tokio::task::spawn_blocking(move || {
        recording
            .cleanup_sessions(policy)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// 导出录制数据到文件 (CSV / NDJSON 等, 由 request 决定)。
pub async fn export_data(
    tb: &Toolbox,
    request: RecordingExportRequest,
) -> Result<RecordingExportResult, String> {
    let store = tb
        .data_plane
        .eval
        .recording
        .store()
        .ok_or_else(|| "recording store is unavailable".to_string())?;
    tokio::task::spawn_blocking(move || {
        recording::export_recording_data(&store, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// 录制子系统健康状态。
pub fn health(tb: &Toolbox) -> RecordingHealth {
    tb.data_plane.eval.recording.health()
}

#[cfg(test)]
mod tests {
    use crate::toolbox::Toolbox;

    /// 未运行 (stopped) 时会话生命周期操作被门控拒绝。
    #[tokio::test]
    async fn session_create_requires_paused_run() {
        let state = app::AppState::new();
        let tb = Toolbox::from_state(&state);
        let error = super::create_session(&tb).await.expect_err("应被门控拒绝");
        assert!(error.contains("paused"));
    }
}
