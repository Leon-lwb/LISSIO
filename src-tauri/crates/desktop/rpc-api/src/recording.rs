//! 录制会话全生命周期 — 创建/切换/列举/查询/SQL/导出/清理。
//!
//! 实现全部在 [`control_api::recording`] (与 MCP 工具、CLI 子命令同源);
//! 本模块只做参数解包与配置目录解析。导出与 SQL 均作用于服务端数据库文件,
//! Web 出口通过下载端点把产物交给浏览器 (见交付文档)。

use std::path::PathBuf;

use backend_host::BackendHost;
use control_api::recording;
use serde_json::Value;

use crate::args::{RpcError, encode, ok, optional, required, text};

/// 录制数据库文件名 (与 `app::start_recording` 的默认落盘位置一致)。
const RECORDING_DATABASE_FILE: &str = "acquisition.duckdb";

/// 录制子系统健康快照。
pub fn health(host: &BackendHost) -> Result<Value, RpcError> {
    encode(&host.state.eval_state().recording.health())
}

/// 全部录制会话。
pub async fn list_sessions(host: &BackendHost) -> Result<Value, RpcError> {
    text(recording::list_sessions(&host.toolbox).await)
}

/// 全部会话摘要 (绑定/批次数/时间范围)。
pub async fn list_session_summaries(host: &BackendHost) -> Result<Value, RpcError> {
    text(recording::list_session_summaries(&host.toolbox).await)
}

/// 指定会话的通道绑定。
pub async fn list_bindings(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let session_id: String = required(args, cmd, "session_id")?;
    text(recording::list_bindings(&host.toolbox, &session_id).await)
}

/// 数据库文件信息 (路径/大小/会话数/批次数)。
pub async fn database_info(host: &BackendHost) -> Result<Value, RpcError> {
    text(recording::database_info(&host.toolbox).await)
}

/// 分页查询历史采样。
#[allow(clippy::too_many_arguments)]
pub async fn query_history(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let session_id: String = required(args, cmd, "session_id")?;
    let binding_id: Option<String> = optional(args, cmd, "binding_id")?;
    let after_row_id: Option<i64> = optional(args, cmd, "after_row_id")?;
    let from_us: Option<u64> = optional(args, cmd, "from_us")?;
    let to_us: Option<u64> = optional(args, cmd, "to_us")?;
    let limit: Option<usize> = optional(args, cmd, "limit")?;
    let include_payload: Option<bool> = optional(args, cmd, "include_payload")?;
    text(
        recording::history_page(
            &host.toolbox,
            recording::HistoryQuery {
                session_id,
                binding_id,
                after_row_id: after_row_id.unwrap_or_default(),
                from_us,
                to_us,
                limit: limit.unwrap_or(500),
                include_payload: include_payload.unwrap_or(false),
            },
        )
        .await,
    )
}

/// 只读 SQL 查询录制数据库。
pub async fn query_sql(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let query_id: String = required(args, cmd, "query_id")?;
    let sql: String = required(args, cmd, "sql")?;
    let max_rows: Option<usize> = optional(args, cmd, "max_rows")?;
    text(recording::query_sql(&host.toolbox, &query_id, &sql, max_rows.unwrap_or(10_000)).await)
}

/// 取消进行中的 SQL 查询。
pub fn cancel_query(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let query_id: String = required(args, cmd, "query_id")?;
    encode(&recording::cancel_query(&host.toolbox, &query_id))
}

/// 强制刷盘。
pub async fn flush(host: &BackendHost) -> Result<Value, RpcError> {
    text(recording::flush(&host.toolbox).await)
}

/// 删除录制会话。
pub async fn delete_session(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let session_id: String = required(args, cmd, "session_id")?;
    text(recording::delete_session(&host.toolbox, &session_id).await)
}

/// 按清理策略删除会话。
pub async fn cleanup_sessions(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let policy: recording::RecordingCleanupPolicy = required(args, cmd, "policy")?;
    text(recording::cleanup_sessions(&host.toolbox, policy).await)
}

/// 导出录制数据到文件 (路径为服务端路径; Web 出口经下载端点交付)。
pub async fn export_data(host: &BackendHost, cmd: &str, args: &Value) -> Result<Value, RpcError> {
    let request: recording::RecordingExportRequest = required(args, cmd, "request")?;
    text(recording::export_data(&host.toolbox, request).await)
}

/// 暂停态新建录制会话并切换写入目标。
pub async fn create_session(host: &BackendHost) -> Result<Value, RpcError> {
    text(recording::create_session(&host.toolbox).await)
}

/// 暂停态切换写入目标到指定已停止会话。
pub async fn switch_session(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let session_id: String = required(args, cmd, "session_id")?;
    text(recording::switch_session(&host.toolbox, &session_id).await)
}

/// 应用录制存储设置 (数据库目录 + 空会话续写开关 + 录制总开关)。
///
/// **总开关可任意运行态热更新**: 关闭会立刻有界关闭 writer 并释放 DuckDB 文件
/// 句柄 (Windows 上是强制锁), 打开则在原库新建会话继续录。只有**改数据库目录**
/// 仍要求暂停/停止 — 那是换写入目标, 不是开关。
pub async fn apply_settings(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let database_dir: Option<String> = optional(args, cmd, "database_dir")?;
    let continue_empty_session: bool = required(args, cmd, "continue_empty_session")?;
    let enabled: Option<bool> = optional(args, cmd, "enabled")?;
    let path = database_dir
        .as_deref()
        .map(str::trim)
        .filter(|dir| !dir.is_empty())
        .map_or_else(
            || {
                host.config_dir
                    .join("recordings")
                    .join(RECORDING_DATABASE_FILE)
            },
            |dir| PathBuf::from(dir).join(RECORDING_DATABASE_FILE),
        );
    let recording_hub = host.state.eval_state().recording;
    if host.state.data_plane.eval.execution.snapshot().state == app::RunState::Running
        && recording_hub.database_path().as_deref() != Some(path.as_path())
    {
        return Err(RpcError::text(
            "recording storage location can only change while the run is paused or stopped",
        ));
    }
    let initial = control_api::recording::session_state_for_run(&host.toolbox);
    // 暂停期间管道继续喂数据 — 换 recorder 前独占数据链边界 (有界: 见
    // `control_api::recording::swap_with_boundary`)。
    control_api::recording::swap_with_boundary(&host.toolbox, move || -> Result<(), String> {
        // 先关: 关闭态下 apply_settings 只登记坐标, 不会打开任何文件。
        if enabled == Some(false) {
            recording_hub.disable().map_err(|error| error.to_string())?;
        }
        recording_hub
            .apply_settings(Some(path), continue_empty_session, initial)
            .map_err(|error| error.to_string())?;
        // 后开: 用刚登记的坐标 (可能已被上一步改过) 建库并新建会话。
        if enabled == Some(true) && !recording_hub.is_enabled() {
            recording_hub
                .enable(initial)
                .map(|_| ())
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(RpcError::text)?;
    ok()
}
