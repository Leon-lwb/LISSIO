//! 波形能力节点 — 实时波形窗口读取 / 缓冲信息 / 停止快照 / CSV 导出。

use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use super::node::CapabilityNode;
use super::tool::{ToolError, ToolOutput, json_result, tool, tool0};
use crate::data;

/// 波形读取入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct WaveformParams {
    /// 数据源 (协议/FrameDecoder 节点 id)。
    source: String,
    /// 读取的最近采样点数 (上限 10000, 缺省 100)。
    #[serde(default = "default_count")]
    count: u32,
}

const fn default_count() -> u32 {
    100
}

/// 时间窗波形读取入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct WaveformWindowParams {
    /// 数据源 (协议/FrameDecoder 节点 id)。
    source: String,
    /// 窗口起点 (相对最新时间戳的毫秒偏移, 负数=过去, 如 -1000)。
    start_ms: i64,
    /// 窗口终点 (同上, 最新为 0)。
    end_ms: i64,
}

/// 缓冲区信息入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct BufferInfoParams {
    /// 数据源节点 id。
    source: String,
}

/// 停止快照创建入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct SnapshotCreateParams {
    /// 数据源 (协议/FrameDecoder 节点 id)。
    source: String,
}

/// 停止快照查询入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct SnapshotQueryParams {
    /// 快照 id (create_waveform_snapshot 返回)。
    snapshot_id: String,
    /// 窗口起点 (相对快照最新时间戳的毫秒偏移, 负数=过去)。
    start_ms: f64,
    /// 窗口终点 (同上)。
    end_ms: f64,
    /// 视觉采样点数 (LTTB 降采样)。
    max_points: u32,
    /// 通道选择 (前端同构 JSON, 缺省 = 全部通道)。
    #[serde(default)]
    selection: Option<Value>,
}

/// 停止快照释放入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct SnapshotReleaseParams {
    /// 快照 id。
    snapshot_id: String,
}

/// 波形 CSV 文件导出入参 (绝对时间范围, 面向无人值守落盘)。
#[derive(Debug, Deserialize, JsonSchema)]
struct WaveformCsvExportParams {
    /// 数据源 (协议/FrameDecoder 节点 id)。
    source: String,
    /// 停止快照 id (缺省 = 当前实时缓冲)。
    snapshot_id: Option<String>,
    /// 起始绝对时间戳 (微秒)。
    start_timestamp_us: u64,
    /// 结束绝对时间戳 (微秒)。
    end_timestamp_us: u64,
    /// 目标 CSV 文件路径。
    path: String,
    /// 通道选择 (前端同构 JSON, 缺省 = 全部通道)。
    #[serde(default)]
    selection: Option<Value>,
}

/// 通道选择 JSON → `WaveformSeriesSelection` (缺省 = 全部通道)。
fn selection(value: Option<&Value>) -> Result<waveform::WaveformSeriesSelection, ToolError> {
    value.map_or_else(
        || Ok(waveform::WaveformSeriesSelection::default()),
        |value| {
            serde_json::from_value(value.clone())
                .map_err(|e| ToolError::InvalidParams(format!("selection: {e}")))
        },
    )
}

/// 构造波形能力节点。
#[must_use]
pub fn node() -> CapabilityNode {
    CapabilityNode {
        id: "waveform",
        title_zh: "波形读取与快照",
        title_en: "Waveform readout & snapshots",
        summary_zh: "实时波形窗口、缓冲信息、停止快照与 CSV 导出",
        summary_en: "Live waveform windows, buffer info, stop snapshots, CSV export",
        tools: vec![
            tool(
                "get_recent_waveform",
                "读取指定数据源 (协议/FrameDecoder 节点 id) 最近 count 个采样点的波形窗口, 含通道名与数值",
                |ctx, p: WaveformParams| async move {
                    json_result(crate::tools::get_recent_waveform(
                        &ctx.toolbox,
                        &p.source,
                        p.count,
                    ))
                },
            ),
            tool(
                "get_waveform_window",
                "读取指定数据源在时间窗口内的波形 (start_ms/end_ms 为相对最新时间戳的毫秒偏移, 负数=过去, 如 start=-1000/end=0 即最近 1 秒)",
                |ctx, p: WaveformWindowParams| async move {
                    json_result(crate::tools::get_waveform_window(
                        &ctx.toolbox,
                        &p.source,
                        p.start_ms,
                        p.end_ms,
                    ))
                },
            ),
            tool(
                "get_buffer_info",
                "读取指定数据源波形缓冲的通道数与点数 {channel_count, point_count}",
                |ctx, p: BufferInfoParams| async move {
                    Ok(ToolOutput::Json(crate::tools::get_buffer_info(
                        &ctx.toolbox,
                        &p.source,
                    )))
                },
            ),
            tool0(
                "list_data_sources",
                "列出存在波形缓冲的数据源 id (可配合 get_recent_waveform 使用)",
                |ctx| async move {
                    Ok(ToolOutput::Json(crate::tools::list_data_sources(
                        &ctx.toolbox,
                    )))
                },
            ),
            tool(
                "create_waveform_snapshot",
                "克隆指定数据源当前的原始波形缓存为停止快照 (可缩放/平移重查询)。返回 {snapshot_id, overview}。受流水线内存预算约束",
                |ctx, p: SnapshotCreateParams| async move {
                    json_result(data::create_waveform_snapshot(&ctx.toolbox, &p.source).await)
                },
            ),
            tool(
                "query_waveform_snapshot",
                "从停止快照读取时间窗波形 (start_ms/end_ms 相对快照最新时间戳, 负数=过去), LTTB 降采样到 max_points",
                |ctx, p: SnapshotQueryParams| async move {
                    let selection = selection(p.selection.as_ref())?;
                    json_result(
                        data::query_waveform_snapshot(
                            &ctx.toolbox,
                            &p.snapshot_id,
                            p.start_ms,
                            p.end_ms,
                            p.max_points as usize,
                            selection,
                        )
                        .await,
                    )
                },
            ),
            tool(
                "release_waveform_snapshot",
                "释放停止快照占用的内存 (snapshot_id 来自 create_waveform_snapshot)",
                |ctx, p: SnapshotReleaseParams| async move {
                    data::release_waveform_snapshot(&ctx.toolbox, &p.snapshot_id);
                    Ok(ToolOutput::Json(serde_json::json!({ "ok": true })))
                },
            ),
            tool(
                "export_waveform_csv",
                "把指定数据源 (或停止快照) 绝对时间范围内的原始样本流式写入 CSV 文件。范围必须完整落在缓存内, 否则拒绝导出残缺数据。返回写入行数",
                |ctx, p: WaveformCsvExportParams| async move {
                    let selection = selection(p.selection.as_ref())?;
                    json_result(
                        data::export_waveform_csv(
                            &ctx.toolbox,
                            &p.source,
                            p.snapshot_id,
                            p.start_timestamp_us,
                            p.end_timestamp_us,
                            selection,
                            p.path,
                        )
                        .await,
                    )
                },
            ),
        ],
        skills: Vec::new(),
    }
}

#[cfg(test)]
#[path = "waveform_tests.rs"]
mod tests;
