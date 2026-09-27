//! 录制能力节点 — 会话生命周期 / 历史查询 / 只读 SQL / 导出。
//!
//! 实现全部委托 [`crate::recording`] (与 IPC / CLI 共用同一份运行态门控与
//! 阻塞线程调度)。

use std::sync::atomic::{AtomicU64, Ordering};

use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use super::node::CapabilityNode;
use super::tool::{ToolError, ToolOutput, json_result, tool, tool0};
use crate::recording;

/// SQL 查询 id 生成器 (能力节点侧自动分配, cancel 场景用)。
static SQL_QUERY_SEQ: AtomicU64 = AtomicU64::new(1);

/// 录制会话 id 入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct RecordingSessionParams {
    /// 录制会话 id (list_recording_sessions 返回)。
    session_id: String,
}

/// 录制历史分页查询入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct RecordingHistoryParams {
    /// 录制会话 id。
    session_id: String,
    /// 通道绑定 id (list_recording_bindings 返回; 缺省 = 全部绑定)。
    binding_id: Option<String>,
    /// 起始行 id 之后 (配合分页翻页)。
    after_row_id: Option<i64>,
    /// 起始时间 (微秒, 含)。
    from_us: Option<u64>,
    /// 结束时间 (微秒, 含)。
    to_us: Option<u64>,
    /// 页大小 (缺省 500)。
    limit: Option<u32>,
    /// 是否携带 payload 字节。
    include_payload: Option<bool>,
}

/// 录制只读 SQL 查询入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct RecordingSqlParams {
    /// SQL 语句 (只读; 表名见 list_recording_sessions / get_recording_database_info)。
    sql: String,
    /// 最大返回行数 (缺省 10000)。
    max_rows: Option<u32>,
}

/// 录制数据导出入参 — request 为前端同构的 RecordingExportRequest JSON。
#[derive(Debug, Deserialize, JsonSchema)]
struct RecordingExportParams {
    /// 导出请求: {sessionId, bindingId?, format, path, ...} (与 IPC 同构)。
    request: Value,
}

/// 构造录制能力节点。
#[must_use]
pub fn node() -> CapabilityNode {
    CapabilityNode {
        id: "recording",
        title_zh: "数据录制",
        title_en: "Data recording",
        summary_zh: "录制会话生命周期、历史分页、只读 SQL 与文件导出",
        summary_en: "Session lifecycle, history paging, read-only SQL, file export",
        tools: vec![
            tool0(
                "list_recording_sessions",
                "列出全部录制会话 [{session_id, state, started_at, rows, ...}]。配合 list_recording_bindings + query_recording_history 读取已记录数据",
                |ctx| async move { json_result(recording::list_sessions(&ctx.toolbox).await) },
            ),
            tool(
                "list_recording_bindings",
                "列出指定录制会话的通道绑定 [{binding_id, source, port, ...}]。binding_id 是 query_recording_history 的查询键",
                |ctx, p: RecordingSessionParams| async move {
                    json_result(recording::list_bindings(&ctx.toolbox, &p.session_id).await)
                },
            ),
            tool0(
                "create_recording_session",
                "新建录制会话并使其成为当前写入目标 (要求工作区处于暂停态: run_workspace pause)。返回新会话信息",
                |ctx| async move { json_result(recording::create_session(&ctx.toolbox).await) },
            ),
            tool(
                "switch_recording_session",
                "把录制写入目标切换到指定的已停止会话 (继续写入该表; 要求工作区处于暂停态)",
                |ctx, p: RecordingSessionParams| async move {
                    json_result(recording::switch_session(&ctx.toolbox, &p.session_id).await)
                },
            ),
            tool(
                "delete_recording_session",
                "删除录制会话及其数据表",
                |ctx, p: RecordingSessionParams| async move {
                    json_result(recording::delete_session(&ctx.toolbox, &p.session_id).await)
                },
            ),
            tool(
                "query_recording_history",
                "分页读取录制的历史采样: session_id + binding_id 定位通道, after_row_id 翻页, from_us/to_us 过滤时间窗 (微秒), limit 页大小 (缺省 500)",
                |ctx, p: RecordingHistoryParams| async move {
                    json_result(
                        recording::history_page(
                            &ctx.toolbox,
                            recording::HistoryQuery {
                                session_id: p.session_id,
                                binding_id: p.binding_id,
                                after_row_id: p.after_row_id.unwrap_or_default(),
                                from_us: p.from_us,
                                to_us: p.to_us,
                                limit: p.limit.unwrap_or(500).max(1) as usize,
                                include_payload: p.include_payload.unwrap_or(false),
                            },
                        )
                        .await,
                    )
                },
            ),
            tool(
                "query_recording_sql",
                "对录制数据库执行只读 SQL (DuckDB 方言), 适合聚合统计。max_rows 限制返回行数 (缺省 10000)",
                |ctx, p: RecordingSqlParams| async move {
                    let query_id = format!("mcp-{}", SQL_QUERY_SEQ.fetch_add(1, Ordering::Relaxed));
                    json_result(
                        recording::query_sql(
                            &ctx.toolbox,
                            &query_id,
                            &p.sql,
                            p.max_rows.unwrap_or(10_000) as usize,
                        )
                        .await,
                    )
                },
            ),
            tool0(
                "get_recording_health",
                "读取录制子系统健康状态 (引擎/存储/最近错误)",
                |ctx| async move {
                    Ok(ToolOutput::Json(
                        serde_json::to_value(recording::health(&ctx.toolbox))
                            .unwrap_or_else(|_| serde_json::json!({})),
                    ))
                },
            ),
            tool0(
                "flush_recording",
                "把录制未落盘的批次强制刷入数据库 (读取前确保数据完整)",
                |ctx| async move { json_result(recording::flush(&ctx.toolbox).await) },
            ),
            tool(
                "export_recording_data",
                "把录制数据导出到文件 (request 为 RecordingExportRequest JSON: {session_id, binding_id?, from_us?, to_us?, format, path})。返回 {rows, bytes}",
                |ctx, p: RecordingExportParams| async move {
                    let request: recording::RecordingExportRequest =
                        serde_json::from_value(p.request)
                            .map_err(|e| ToolError::InvalidParams(format!("request: {e}")))?;
                    json_result(recording::export_data(&ctx.toolbox, request).await)
                },
            ),
        ],
        skills: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 节点声明 10 个工具。
    #[test]
    fn node_declares_tools() {
        let n = node();
        assert_eq!(n.tools.len(), 10);
        assert_eq!(n.tools[0].name, "list_recording_sessions");
        assert_eq!(n.tools[9].name, "export_recording_data");
    }
}
