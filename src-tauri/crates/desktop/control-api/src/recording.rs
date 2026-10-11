//! 录制会话 — 无人值守采集记录的会话生命周期 / 查询 / 导出能力。
//!
//! 实现全部委托 `recording` crate (`RecordingHub`), 本模块补充运行态门控
//! (会话创建/切换仅在暂停态开放) 与阻塞线程调度, Tauri IPC 命令与 MCP/CLI
//! 共用同一份实现。
//!
//! 暂停期间数据链仍在写入 (暂停只停发送), 换 recorder 不再天然有安静窗口:
//! 创建/切换时持 `execution.boundary` 写锁跨越整个替换过程 — 在途路由批次先写完,
//! 替换期间不放行新批次, 替换完成后再恢复, 批次不会落在 recorder 缺席的窗口。
//!
//! **但这段写锁是有界的**: 打开/重建 DuckDB 在 Windows 强制锁下可能不返回, 写锁
//! 被这样的调用跨住会让采集侧的一切读锁 (评估 / 发送 / 路由) 全部堵死。超过
//! [`SWAP_TIMEOUT`] 就释放写锁并报错, 先让采集与运行控制恢复。

pub use recording::{
    BindingInfo, HistoryPage, HistoryQuery, RecordingCleanupPolicy, RecordingCleanupResult,
    RecordingDatabaseInfo, RecordingExportRequest, RecordingExportResult, RecordingHealth,
    SessionInfo, SessionState, SessionSummary, SqlResult,
};

use std::time::Duration;

use crate::toolbox::Toolbox;

/// 换 recorder 时独占数据链边界的上限 — 只为「写锁必然释放」兜底。
/// 正常打开数据库是毫秒级, 30 秒已经远超健康路径。
pub const SWAP_TIMEOUT: Duration = Duration::from_secs(30);

/// 超时提示 — 与「打不开」区分开: 这里可能只是慢, 调用方据此外显即可。
const SWAP_TIMEOUT_MESSAGE: &str =
    "recording storage did not respond in time; acquisition was released from the storage swap";

/// 录制会话生命周期操作仅在运行暂停时开放。
fn require_paused_run(tb: &Toolbox) -> Result<(), String> {
    if tb.data_plane.eval.execution.snapshot().state == pipeline::RunState::Paused {
        return Ok(());
    }
    Err("recording sessions can only be created or switched while the run is paused".into())
}

/// 新建/续写会话时的初始状态 — 反映"是否正在写入"。
///
/// 暂停期间数据链与录制都在继续, 因此运行态与暂停态都记为 `Running`; 只有停止态
/// 才是"recorder 就绪但未写入"(`Paused`)。
#[must_use]
pub fn session_state_for_run(tb: &Toolbox) -> SessionState {
    if tb.data_plane.eval.execution.snapshot().state == pipeline::RunState::Stopped {
        SessionState::Paused
    } else {
        SessionState::Running
    }
}

/// 持数据链边界写锁执行一次 recorder 替换 — **有界**。
///
/// 写锁在阻塞段全程持有 (换 recorder 不能与在途批次交错), 但等待该阻塞段的时间
/// 被 [`SWAP_TIMEOUT`] 限住: 超时即释放写锁并报错。放在一个函数里是为了让这条
/// 「锁一定有界释放」的契约只有一处实现, 三个调用点不会各自漂移。
///
/// # Errors
/// 替换失败或超过 [`SWAP_TIMEOUT`] 时返回提示文本。
pub async fn swap_with_boundary<T, F>(tb: &Toolbox, swap: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let boundary = tb.data_plane.eval.execution.boundary.write().await;
    let outcome = tokio::time::timeout(SWAP_TIMEOUT, tokio::task::spawn_blocking(swap)).await;
    // 无论超时与否, 边界写锁必须在这里释放: 采集侧的一切读锁都在等它。
    drop(boundary);
    match outcome {
        Ok(joined) => joined.map_err(|error| error.to_string())?,
        Err(_) => Err(SWAP_TIMEOUT_MESSAGE.to_string()),
    }
}

/// 暂停时新建录制会话并使其成为当前写入目标;被替换的会话标记为已停止。
pub async fn create_session(tb: &Toolbox) -> Result<SessionInfo, String> {
    require_paused_run(tb)?;
    let recording = tb.data_plane.eval.recording.clone();
    let initial = session_state_for_run(tb);
    // 暂停期间管道继续喂数据 — 独占数据链边界, 在途批次走完再换 recorder
    swap_with_boundary(tb, move || {
        recording
            .create_session(initial)
            .map_err(|error| error.to_string())
    })
    .await
}

/// 暂停时把写入目标切换到指定的已停止会话(继续写入该表)。
pub async fn switch_session(tb: &Toolbox, session_id: &str) -> Result<SessionInfo, String> {
    require_paused_run(tb)?;
    let recording = tb.data_plane.eval.recording.clone();
    let session_id = session_id.to_string();
    let initial = session_state_for_run(tb);
    swap_with_boundary(tb, move || {
        recording
            .switch_session(&session_id, initial)
            .map_err(|error| error.to_string())
    })
    .await
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
#[path = "recording_tests.rs"]
mod tests;
