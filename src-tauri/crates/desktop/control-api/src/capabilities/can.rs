//! CAN 能力节点 — 帧读取与帧发送。

use can::CanFrame;
use schemars::JsonSchema;
use serde::Deserialize;

use super::node::CapabilityNode;
use super::tool::{ToolOutput, json_result, tool};
use crate::tools;

/// CAN 帧读取入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct CanFramesParams {
    /// 读取的最近帧条数 (上限 1000, 缺省 100)。
    #[serde(default = "default_frame_count")]
    count: u32,
    /// 总线比特率 (用于负载百分比估算, 缺省 500k)。
    bitrate: Option<u32>,
}

const fn default_frame_count() -> u32 {
    100
}

/// CAN 帧发送入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct SendCanFrameParams {
    /// 目标设备节点 id。
    node_id: String,
    /// 编码用 Protocol 节点 id (缺省沿字节平面自动溯源第一个)。
    protocol_node: Option<String>,
    /// CAN 帧 (id 11/29 位;extended = 扩展帧;direction 通常 tx)。
    frame: CanFrameDto,
}

/// CAN 帧入参 DTO — 本地定义以派生 `JsonSchema` (`can::CanFrame` 无此派生)。
#[derive(Debug, Deserialize, JsonSchema)]
struct CanFrameDto {
    /// 帧 id (11 位标准帧或 29 位扩展帧)。
    id: u32,
    /// 是否扩展帧 (29 位 id);缺省按 id 是否超过 11 位范围推断。
    #[serde(default)]
    extended: Option<bool>,
    /// 是否远程帧。
    #[serde(default)]
    rtr: bool,
    /// 数据字节 (最多 8 个, 超出截断)。
    #[serde(default)]
    data: Vec<u8>,
    /// 方向 ("tx"/"rx", 发送填 "tx")。
    #[serde(default)]
    direction: Option<String>,
}

impl From<CanFrameDto> for CanFrame {
    fn from(dto: CanFrameDto) -> Self {
        let direction = match dto.direction.as_deref() {
            Some("tx" | "Tx" | "TX") => can::CanDirection::Tx,
            _ => can::CanDirection::Rx,
        };
        // 缺省按 id 位数推断: 29 位 id 即扩展帧
        let extended = dto.extended.unwrap_or(dto.id > 0x7FF);
        let mut frame = tools::build_can_frame(dto.id, dto.data, extended);
        frame.rtr = dto.rtr;
        frame.direction = direction;
        frame
    }
}

/// 构造 CAN 能力节点。
#[must_use]
pub fn node() -> CapabilityNode {
    CapabilityNode {
        id: "can",
        title_zh: "CAN 总线",
        title_en: "CAN bus",
        summary_zh: "最近帧与负载统计读取、CAN 帧编码发送",
        summary_en: "Recent frames & load stats, CAN frame encode & send",
        tools: vec![
            tool(
                "get_can_frames",
                "读取最近 CAN 帧 [{timestamp, id, extended, dlc, data, direction}] 与总线负载统计 {fps, load_ratio}",
                |ctx, p: CanFramesParams| async move {
                    Ok(ToolOutput::Json(tools::get_can_frames(
                        &ctx.toolbox,
                        p.count,
                        p.bitrate,
                    )))
                },
            ),
            tool(
                "send_can_frame",
                "发送 CAN 帧 (经 CAN 协议节点 encode_can 编码)。protocol_node 缺省时沿字节平面自动溯源该传输下游的第一个 Protocol 节点",
                |ctx, p: SendCanFrameParams| async move {
                    json_result(
                        tools::send_can_frame(
                            &ctx.toolbox,
                            &p.node_id,
                            p.protocol_node,
                            p.frame.into(),
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
#[path = "can_tests.rs"]
mod tests;
