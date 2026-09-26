//! MCP 工具入参 DTO — schemars 派生 JSON Schema (与外部客户端契约)

use can::CanFrame;
use rmcp::schemars;
use serde::Deserialize;
use serde_json::Value;

/// 发送字节的入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct SendBytesParams {
    /// 目标传输节点 id。
    pub(super) node_id: String,
    /// 字节数组 (0-255)。
    pub(super) data: Vec<u8>,
}

/// 发送文本的入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct SendStringParams {
    /// 目标传输节点 id。
    pub(super) node_id: String,
    /// UTF-8 文本。
    pub(super) text: String,
}

/// 字节注入入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct InjectBytesParams {
    /// 注入源节点 id (字节边起点)。
    pub(super) source_node_id: String,
    /// 字节数组 (0-255)。
    pub(super) data: Vec<u8>,
}

/// 输入控件赋值入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct SetInputValueParams {
    /// 控件节点 id。
    pub(super) widget_id: String,
    /// 目标值。
    pub(super) value: f32,
}

/// 波形读取入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct WaveformParams {
    /// 数据源 (协议/FrameDecoder 节点 id)。
    pub(super) source: String,
    /// 读取的最近采样点数。
    pub(super) count: u32,
}

/// 时间窗波形读取入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct WaveformWindowParams {
    /// 数据源 (协议/FrameDecoder 节点 id)。
    pub(super) source: String,
    /// 窗口起点 (相对最新时间戳的毫秒偏移, 负数=过去)。
    pub(super) start_ms: i64,
    /// 窗口终点 (同上)。
    pub(super) end_ms: i64,
}

/// 缓冲区信息入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct BufferInfoParams {
    /// 数据源节点 id。
    pub(super) source: String,
}

/// 图更新参数 — nodes/edges 为前端同构的 JSON (`NodeDef` / `Edge`)。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct UpdateGraphParams {
    pub(super) tab_id: String,
    /// Complete node documents: id, tabId, label, layout, kind, config, attributes.
    pub(super) documents: Vec<Value>,
    pub(super) edges: Vec<Value>,
}

/// 连线入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct ConnectEdgeParams {
    /// 源节点 id。
    pub(super) source: String,
    /// 目标节点 id。
    pub(super) target: String,
    /// 归属 tab (缺省自动定位: 优先同时持有两端的 tab)。
    pub(super) tab_id: Option<String>,
    /// 源端口 id (缺省按端口提示/节点类型补默认, 如 rx / out)。
    pub(super) source_handle: Option<String>,
    /// 目标端口 id (缺省按端口提示/节点类型补默认, 如 in)。
    pub(super) target_handle: Option<String>,
}

/// 删线入参 — edge_id 或 source/target 至少给一个。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct DisconnectEdgeParams {
    /// 连线 id (优先精确匹配)。
    pub(super) edge_id: Option<String>,
    /// 源节点 id (与 target 组合过滤, 可只给一端)。
    pub(super) source: Option<String>,
    /// 目标节点 id。
    pub(super) target: Option<String>,
}

/// CAN 帧读取入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct CanFramesParams {
    /// 读取的最近帧条数 (上限 1000)。
    pub(super) count: u32,
    /// 总线比特率 (用于负载百分比估算, 缺省 500k)。
    pub(super) bitrate: Option<u32>,
}

/// CAN 帧发送入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct SendCanFrameParams {
    /// 目标设备节点 id。
    pub(super) node_id: String,
    /// 编码用 Protocol 节点 id (缺省沿字节平面自动溯源第一个)。
    pub(super) protocol_node: Option<String>,
    /// CAN 帧 (id 11/29 位;extended = 扩展帧;direction 通常 tx)。
    pub(super) frame: CanFrameDto,
}

/// CAN 帧入参 DTO — 本地定义以派生 `JsonSchema` (`can::CanFrame` 无此派生)。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct CanFrameDto {
    /// 帧 id (11 位标准帧或 29 位扩展帧)。
    pub(super) id: u32,
    /// 是否扩展帧 (29 位 id)。
    #[serde(default)]
    pub(super) extended: bool,
    /// 是否远程帧。
    #[serde(default)]
    pub(super) rtr: bool,
    /// 数据字节 (最多 8 个)。
    #[serde(default)]
    pub(super) data: Vec<u8>,
    /// 方向 ("tx"/"rx", 发送填 "tx")。
    #[serde(default)]
    pub(super) direction: Option<String>,
}

impl From<CanFrameDto> for CanFrame {
    fn from(dto: CanFrameDto) -> Self {
        let direction = match dto.direction.as_deref() {
            Some("tx" | "Tx" | "TX") => can::CanDirection::Tx,
            _ => can::CanDirection::Rx,
        };
        let mut frame = control_api::tools::build_can_frame(dto.id, dto.data, dto.extended);
        frame.rtr = dto.rtr;
        frame.direction = direction;
        frame
    }
}

#[cfg(test)]
mod tests {
    use super::{CloseEndpointParams, ReadPointsParams, WritePointsParams};
    use serde_json::json;

    #[test]
    fn node_identity_payloads_deserialize() {
        let close: CloseEndpointParams =
            serde_json::from_value(json!({ "node_id": "node-a" })).unwrap();
        let read: ReadPointsParams = serde_json::from_value(json!({
            "node_id": "node-a",
            "point_ids": ["p1"]
        }))
        .unwrap();
        let write: WritePointsParams = serde_json::from_value(json!({
            "node_id": "node-a",
            "request": {}
        }))
        .unwrap();

        assert_eq!(close.node_id, "node-a");
        assert_eq!(read.node_id, "node-a");
        assert_eq!(write.node_id, "node-a");
    }
}

/// 逻辑分析数据读取入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct LogicParams {
    /// 读取的最近采样 / 事件条数 (上限 5000)。
    pub(super) count: u32,
}

/// 原始字节读取入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct RawDataParams {
    /// 数据源节点 id (Transport 或 FrameDecoder)。
    pub(super) source: String,
    /// 最大读取字节数 (上限 64KiB)。
    pub(super) max_bytes: u32,
}

/// 打开端点入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct OpenEndpointParams {
    /// 图中设备节点 id (Acquisition 节点)。
    pub(super) node_id: String,
}

/// 关闭端点入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct CloseEndpointParams {
    /// 图中采集节点 id。
    pub(super) node_id: String,
}

/// 点位读取入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct ReadPointsParams {
    /// 图中采集节点 id。
    pub(super) node_id: String,
    /// 点位 id 数组。
    pub(super) point_ids: Vec<String>,
}

/// 点位写入入参 — `request` 为 `points::WriteRequest` JSON。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct WritePointsParams {
    /// 图中采集节点 id。
    pub(super) node_id: String,
    /// 写入请求: {correlationId, deadlineUnixNs, idempotencyKey?, items:[{pointId, value}]}。
    pub(super) request: Value,
}

/// 运行控制动作入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub(super) enum RunActionDto {
    /// 启动 / 恢复。
    Start,
    /// 暂停。
    Pause,
    /// 停止。
    Stop,
}

impl From<RunActionDto> for pipeline::RunAction {
    fn from(dto: RunActionDto) -> Self {
        match dto {
            RunActionDto::Start => Self::Start,
            RunActionDto::Pause => Self::Pause,
            RunActionDto::Stop => Self::Stop,
        }
    }
}

/// 运行控制入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct RunWorkspaceParams {
    /// 目标动作。
    pub(super) action: RunActionDto,
}

/// 停止快照创建入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct SnapshotCreateParams {
    /// 数据源 (协议/FrameDecoder 节点 id)。
    pub(super) source: String,
}

/// 停止快照查询入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct SnapshotQueryParams {
    /// 快照 id (create_waveform_snapshot 返回)。
    pub(super) snapshot_id: String,
    /// 窗口起点 (相对最新时间戳的毫秒偏移, 负数=过去)。
    pub(super) start_ms: f64,
    /// 窗口终点 (同上)。
    pub(super) end_ms: f64,
    /// 视觉采样点数 (LTTB 降采样)。
    pub(super) max_points: u32,
    /// 通道选择 (前端同构 JSON, 缺省 = 全部通道)。
    #[serde(default)]
    pub(super) selection: Option<Value>,
}

/// 停止快照释放入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct SnapshotReleaseParams {
    /// 快照 id。
    pub(super) snapshot_id: String,
}

/// 波形 CSV 文件导出入参 (绝对时间范围, 面向无人值守落盘)。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct WaveformCsvExportParams {
    /// 数据源 (协议/FrameDecoder 节点 id)。
    pub(super) source: String,
    /// 停止快照 id (缺省 = 当前实时缓冲)。
    pub(super) snapshot_id: Option<String>,
    /// 起始绝对时间戳 (微秒)。
    pub(super) start_timestamp_us: u64,
    /// 结束绝对时间戳 (微秒)。
    pub(super) end_timestamp_us: u64,
    /// 目标 CSV 文件路径。
    pub(super) path: String,
    /// 通道选择 (前端同构 JSON, 缺省 = 全部通道)。
    #[serde(default)]
    pub(super) selection: Option<Value>,
}

/// 命令帧字节打包入参 — frame 为前端同构的 CommandFrameDto JSON。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct CommandFrameParams {
    /// 命令帧定义 (CommandFrameDto JSON: blocks 等, 与前端 CommandFrame 同构)。
    pub(super) frame: Value,
    /// var_ref 端口输入值 (按端口名索引)。
    #[serde(default)]
    pub(super) inputs: std::collections::HashMap<String, f64>,
}

/// 命令帧发送入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct SendCommandFrameParams {
    /// 命令发送器 widget 节点 id (字节边起点)。
    pub(super) widget_id: String,
    /// 命令帧定义 (CommandFrameDto JSON)。
    pub(super) frame: Value,
    /// var_ref 端口输入值 (按端口名索引)。
    #[serde(default)]
    pub(super) inputs: std::collections::HashMap<String, f64>,
}

/// 录制会话 id 入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct RecordingSessionParams {
    /// 录制会话 id (list_recording_sessions 返回)。
    pub(super) session_id: String,
}

/// 录制历史分页查询入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct RecordingHistoryParams {
    /// 录制会话 id。
    pub(super) session_id: String,
    /// 通道绑定 id (list_recording_bindings 返回; 缺省 = 全部绑定)。
    pub(super) binding_id: Option<String>,
    /// 起始行 id 之后 (配合分页翻页)。
    pub(super) after_row_id: Option<i64>,
    /// 起始时间 (微秒, 含)。
    pub(super) from_us: Option<u64>,
    /// 结束时间 (微秒, 含)。
    pub(super) to_us: Option<u64>,
    /// 页大小 (缺省 500)。
    pub(super) limit: Option<u32>,
    /// 是否携带 payload 字节。
    pub(super) include_payload: Option<bool>,
}

/// 录制只读 SQL 查询入参。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct RecordingSqlParams {
    /// SQL 语句 (只读; 表名见 list_recording_sessions / get_recording_database_info)。
    pub(super) sql: String,
    /// 最大返回行数 (缺省 10000)。
    pub(super) max_rows: Option<u32>,
}

/// 录制数据导出入参 — request 为前端同构的 RecordingExportRequest JSON。
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub(super) struct RecordingExportParams {
    /// 导出请求: {sessionId, bindingId?, format, path, ...} (与 IPC 同构)。
    pub(super) request: Value,
}
