//! MCP 录制工具 — 会话生命周期 / 历史查询 / SQL / 导出。
//!
//! 实现全部委托 [`control_api::recording`] (与 Tauri IPC / CLI 共用同一份
//! 运行态门控与阻塞线程调度)。

use std::sync::atomic::{AtomicU64, Ordering};

use control_api::recording;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock};

use super::super::params::{
    RecordingExportParams, RecordingHistoryParams, RecordingSessionParams, RecordingSqlParams,
};
use super::VofaMcpServer;
use super::internal;

/// SQL 查询 id 生成器 (MCP 侧自动分配, cancel 场景用)。
static SQL_QUERY_SEQ: AtomicU64 = AtomicU64::new(1);

/// 序列化值的工具结果统一包装 (与 mod.rs 同语义)。
fn tool_result(value: impl serde::Serialize) -> Result<CallToolResult, rmcp::ErrorData> {
    let content = ContentBlock::json(value)?;
    Ok(CallToolResult::success(vec![content]))
}

#[rmcp::tool_router(router = recording_router, vis = "pub(crate)")]
impl VofaMcpServer {
    /// 列出全部录制会话 (含状态与行数)。
    #[rmcp::tool(
        description = "列出全部录制会话 [{session_id, state, started_at, rows, ...}]。配合 list_recording_bindings + query_recording_history 读取已记录数据"
    )]
    async fn list_recording_sessions(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        recording::list_sessions(&self.toolbox)
            .await
            .map_err(internal)
            .and_then(tool_result)
    }

    /// 列出指定会话的通道绑定。
    #[rmcp::tool(
        description = "列出指定录制会话的通道绑定 [{binding_id, source, port, ...}]。binding_id 是 query_recording_history 的查询键"
    )]
    async fn list_recording_bindings(
        &self,
        Parameters(params): Parameters<RecordingSessionParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        recording::list_bindings(&self.toolbox, &params.session_id)
            .await
            .map_err(internal)
            .and_then(tool_result)
    }

    /// 暂停态新建录制会话并切换写入目标。
    #[rmcp::tool(
        description = "新建录制会话并使其成为当前写入目标 (要求工作区处于暂停态: run_workspace pause)。返回新会话信息"
    )]
    async fn create_recording_session(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        recording::create_session(&self.toolbox)
            .await
            .map_err(internal)
            .and_then(tool_result)
    }

    /// 暂停态切换写入目标到指定已停止会话。
    #[rmcp::tool(
        description = "把录制写入目标切换到指定的已停止会话 (继续写入该表; 要求工作区处于暂停态)"
    )]
    async fn switch_recording_session(
        &self,
        Parameters(params): Parameters<RecordingSessionParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        recording::switch_session(&self.toolbox, &params.session_id)
            .await
            .map_err(internal)
            .and_then(tool_result)
    }

    /// 删除录制会话。
    #[rmcp::tool(description = "删除录制会话及其数据表")]
    async fn delete_recording_session(
        &self,
        Parameters(params): Parameters<RecordingSessionParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        recording::delete_session(&self.toolbox, &params.session_id)
            .await
            .map_err(internal)
            .and_then(tool_result)
    }

    /// 分页查询录制历史。
    #[rmcp::tool(
        description = "分页读取录制的历史采样: session_id + binding_id 定位通道, after_row_id 翻页, from_us/to_us 过滤时间窗 (微秒), limit 页大小 (缺省 500)"
    )]
    async fn query_recording_history(
        &self,
        Parameters(params): Parameters<RecordingHistoryParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        recording::history_page(
            &self.toolbox,
            recording::HistoryQuery {
                session_id: params.session_id,
                binding_id: params.binding_id,
                after_row_id: params.after_row_id.unwrap_or_default(),
                from_us: params.from_us,
                to_us: params.to_us,
                limit: params.limit.unwrap_or(500).max(1) as usize,
                include_payload: params.include_payload.unwrap_or(false),
            },
        )
        .await
        .map_err(internal)
        .and_then(tool_result)
    }

    /// 只读 SQL 查询录制数据库。
    #[rmcp::tool(
        description = "对录制数据库执行只读 SQL (DuckDB 方言), 适合聚合统计。max_rows 限制返回行数 (缺省 10000)"
    )]
    async fn query_recording_sql(
        &self,
        Parameters(params): Parameters<RecordingSqlParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let query_id = format!("mcp-{}", SQL_QUERY_SEQ.fetch_add(1, Ordering::Relaxed));
        recording::query_sql(
            &self.toolbox,
            &query_id,
            &params.sql,
            params.max_rows.unwrap_or(10_000) as usize,
        )
        .await
        .map_err(internal)
        .and_then(tool_result)
    }

    /// 录制子系统健康状态。
    #[rmcp::tool(description = "读取录制子系统健康状态 (引擎/存储/最近错误)")]
    async fn get_recording_health(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        tool_result(recording::health(&self.toolbox))
    }

    /// 强制刷盘。
    #[rmcp::tool(description = "把录制未落盘的批次强制刷入数据库 (读取前确保数据完整)")]
    async fn flush_recording(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        recording::flush(&self.toolbox)
            .await
            .map_err(internal)
            .and_then(tool_result)
    }

    /// 导出录制数据到文件。
    #[rmcp::tool(
        description = "把录制数据导出到文件 (request 为 RecordingExportRequest JSON: {session_id, binding_id?, from_us?, to_us?, format, path})。返回 {rows, bytes}"
    )]
    async fn export_recording_data(
        &self,
        Parameters(params): Parameters<RecordingExportParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let request: recording::RecordingExportRequest = serde_json::from_value(params.request)
            .map_err(|e| internal(format!("request: {e}")))?;
        recording::export_data(&self.toolbox, request)
            .await
            .map_err(internal)
            .and_then(tool_result)
    }
}
