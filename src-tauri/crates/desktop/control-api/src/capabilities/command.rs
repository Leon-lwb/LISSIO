//! 命令帧能力节点 — 帧编码预览与统一内核发送。

use std::collections::HashMap;

use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use super::node::CapabilityNode;
use super::tool::{ToolError, json_ok, json_result, tool};
use crate::data;

/// 命令帧字节打包入参 — frame 为前端同构的 CommandFrameDto JSON。
#[derive(Debug, Deserialize, JsonSchema)]
struct CommandFrameParams {
    /// 命令帧定义 (CommandFrameDto JSON: blocks 等, 与前端 CommandFrame 同构)。
    frame: Value,
    /// var_ref 端口输入值 (按端口名索引)。
    #[serde(default)]
    inputs: HashMap<String, f64>,
}

/// 命令帧发送入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct SendCommandFrameParams {
    /// 命令发送器 widget 节点 id (字节边起点)。
    widget_id: String,
    /// 命令帧定义 (CommandFrameDto JSON)。
    frame: Value,
    /// var_ref 端口输入值 (按端口名索引)。
    #[serde(default)]
    inputs: HashMap<String, f64>,
}

/// 命令帧 JSON → `CommandFrameDto`。
fn frame_dto(value: &Value) -> Result<schema::command_frame::CommandFrameDto, ToolError> {
    serde_json::from_value(value.clone())
        .map_err(|e| ToolError::InvalidParams(format!("frame: {e}")))
}

/// 构造命令帧能力节点。
#[must_use]
pub fn node() -> CapabilityNode {
    CapabilityNode {
        id: "command",
        title_zh: "命令帧",
        title_en: "Command frames",
        summary_zh: "命令帧字节编码预览与统一内核发送",
        summary_en: "Command frame byte encode preview and unified send",
        tools: vec![
            tool(
                "compute_command_frame_bytes",
                "把命令帧定义编码为字节 (与发送同内核), 用于预览。返回 {bytes|null, error|null, per_block}; inputs 为 var_ref 端口输入值 {端口名: 数值}",
                |_ctx, p: CommandFrameParams| async move {
                    let frame = frame_dto(&p.frame)?;
                    json_ok(data::compute_command_frame_bytes(&frame, &p.inputs))
                },
            ),
            tool(
                "send_command_frame",
                "发送命令帧: 编码后沿全局字节平面路由到命令发送器 widget_id 的下游 (真实设备发送/回环解析)。要求工作区已运行 (run_workspace start)。返回 {computed, targets, sent, error}",
                |ctx, p: SendCommandFrameParams| async move {
                    let frame = frame_dto(&p.frame)?;
                    json_result(
                        data::send_command_frame(&ctx.toolbox, &p.widget_id, &frame, &p.inputs)
                            .await,
                    )
                },
            ),
        ],
        skills: Vec::new(),
    }
}

#[cfg(test)]
#[path = "command_tests.rs"]
mod tests;
