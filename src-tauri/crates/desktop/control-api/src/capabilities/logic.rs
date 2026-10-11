//! 逻辑分析能力节点 — 采样与解码事件读取。

use schemars::JsonSchema;
use serde::Deserialize;

use super::node::CapabilityNode;
use super::tool::{ToolOutput, tool};
use crate::tools;

/// 逻辑分析数据读取入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct LogicParams {
    /// 读取的最近采样 / 事件条数 (上限 5000, 缺省 200)。
    #[serde(default = "default_logic_count")]
    count: u32,
}

const fn default_logic_count() -> u32 {
    200
}

/// 构造逻辑分析能力节点。
#[must_use]
pub fn node() -> CapabilityNode {
    CapabilityNode {
        id: "logic",
        title_zh: "逻辑分析",
        title_en: "Logic analysis",
        summary_zh: "最近采样与 UART/I2C/SPI 等解码事件读取",
        summary_en: "Recent samples and UART/I2C/SPI decoded events",
        tools: vec![tool(
            "get_logic_data",
            "读取逻辑分析仪最近采样与解码事件 (UART/I2C/SPI 等) {samples, decoded_events}",
            |ctx, p: LogicParams| async move {
                Ok(ToolOutput::Json(tools::get_logic_data(
                    &ctx.toolbox,
                    p.count,
                )))
            },
        )],
        skills: Vec::new(),
    }
}

#[cfg(test)]
#[path = "logic_tests.rs"]
mod tests;
