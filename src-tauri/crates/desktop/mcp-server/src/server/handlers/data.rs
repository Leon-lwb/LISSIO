//! MCP 数据工具 — 波形停止快照 / CSV 导出 / 命令帧编码与发送。
//!
//! 与 mod.rs 的主路由分离 (独立 `#[tool_router]` 块, `+` 合并);
//! 实现全部委托 [`control_api::data`]。

use control_api::data;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock};

use super::super::params::{
    CommandFrameParams, SendCommandFrameParams, SnapshotCreateParams, SnapshotQueryParams,
    SnapshotReleaseParams, WaveformCsvExportParams,
};
use super::VofaMcpServer;
use super::internal;

/// 序列化值的工具结果统一包装 (与 mod.rs 同语义)。
fn tool_result(value: impl serde::Serialize) -> Result<CallToolResult, rmcp::ErrorData> {
    let content = ContentBlock::json(value)?;
    Ok(CallToolResult::success(vec![content]))
}

/// 通道选择 JSON → `WaveformSeriesSelection` (缺省 = 全部通道)。
fn selection(
    value: Option<&serde_json::Value>,
) -> Result<waveform::WaveformSeriesSelection, rmcp::ErrorData> {
    value.map_or_else(
        || Ok(waveform::WaveformSeriesSelection::default()),
        |value| {
            serde_json::from_value(value.clone()).map_err(|e| internal(format!("selection: {e}")))
        },
    )
}

/// 命令帧 JSON → `CommandFrameDto`。
fn frame_dto(value: &serde_json::Value) -> Result<pipeline::CommandFrameDto, rmcp::ErrorData> {
    serde_json::from_value(value.clone()).map_err(|e| internal(format!("frame: {e}")))
}

#[rmcp::tool_router(router = data_router, vis = "pub(crate)")]
impl VofaMcpServer {
    /// 创建波形停止快照 (克隆当前原始环形缓存, 受内存预算约束)。
    #[rmcp::tool(
        description = "克隆指定数据源当前的原始波形缓存为停止快照 (可缩放/平移重查询)。返回 {snapshot_id, overview}。受流水线内存预算约束"
    )]
    async fn create_waveform_snapshot(
        &self,
        Parameters(params): Parameters<SnapshotCreateParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        data::create_waveform_snapshot(&self.toolbox, &params.source)
            .await
            .map_err(internal)
            .and_then(tool_result)
    }

    /// 查询停止快照时间窗内的波形 (LTTB 视觉采样)。
    #[rmcp::tool(
        description = "从停止快照读取时间窗波形 (start_ms/end_ms 相对快照最新时间戳, 负数=过去), LTTB 降采样到 max_points"
    )]
    async fn query_waveform_snapshot(
        &self,
        Parameters(params): Parameters<SnapshotQueryParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let selection = selection(params.selection.as_ref())?;
        data::query_waveform_snapshot(
            &self.toolbox,
            &params.snapshot_id,
            params.start_ms,
            params.end_ms,
            params.max_points as usize,
            selection,
        )
        .await
        .map_err(internal)
        .and_then(tool_result)
    }

    /// 释放停止快照。
    #[rmcp::tool(
        description = "释放停止快照占用的内存 (snapshot_id 来自 create_waveform_snapshot)"
    )]
    async fn release_waveform_snapshot(
        &self,
        Parameters(params): Parameters<SnapshotReleaseParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        data::release_waveform_snapshot(&self.toolbox, &params.snapshot_id);
        tool_result(serde_json::json!({ "ok": true }))
    }

    /// 按绝对时间范围导出原始波形到 CSV 文件。
    #[rmcp::tool(
        description = "把指定数据源 (或停止快照) 绝对时间范围内的原始样本流式写入 CSV 文件。范围必须完整落在缓存内, 否则拒绝导出残缺数据。返回写入行数"
    )]
    async fn export_waveform_csv(
        &self,
        Parameters(params): Parameters<WaveformCsvExportParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let selection = selection(params.selection.as_ref())?;
        data::export_waveform_csv(
            &self.toolbox,
            &params.source,
            params.snapshot_id,
            params.start_timestamp_us,
            params.end_timestamp_us,
            selection,
            params.path,
        )
        .await
        .map_err(internal)
        .and_then(tool_result)
    }

    /// 命令帧字节打包预览 (不发送)。
    #[rmcp::tool(
        description = "把命令帧定义编码为字节 (与发送同内核), 用于预览。返回 {bytes|null, error|null, per_block}; inputs 为 var_ref 端口输入值 {端口名: 数值}"
    )]
    async fn compute_command_frame_bytes(
        &self,
        Parameters(params): Parameters<CommandFrameParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let frame = frame_dto(&params.frame)?;
        tool_result(data::compute_command_frame_bytes(&frame, &params.inputs))
    }

    /// 手动发送命令帧 (统一发送内核, 需要工作区运行中)。
    #[rmcp::tool(
        description = "发送命令帧: 编码后沿全局字节平面路由到命令发送器 widget_id 的下游 (真实设备发送/回环解析)。要求工作区已运行 (run_workspace start)。返回 {computed, targets, sent, error}"
    )]
    async fn send_command_frame(
        &self,
        Parameters(params): Parameters<SendCommandFrameParams>,
    ) -> Result<CallToolResult, rmcp::ErrorData> {
        let frame = frame_dto(&params.frame)?;
        data::send_command_frame(&self.toolbox, &params.widget_id, &frame, &params.inputs)
            .await
            .map_err(internal)
            .and_then(tool_result)
    }
}
