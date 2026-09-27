//! 采集控制能力节点 — 端点开闭 / 设备树与驱动目录 / 点位读写 / 运行控制。

use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use super::node::CapabilityNode;
use super::tool::{ToolError, ToolOutput, json_result, tool, tool0};
use crate::control;

/// 图中设备节点 id 入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct NodeIdParams {
    /// 图中设备/采集节点 id (Acquisition 节点)。
    node_id: String,
}

/// 点位读取入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct ReadPointsParams {
    /// 图中采集节点 id。
    node_id: String,
    /// 点位 id 数组。
    point_ids: Vec<String>,
}

/// 点位写入入参 — `request` 为 `points::WriteRequest` JSON。
#[derive(Debug, Deserialize, JsonSchema)]
struct WritePointsParams {
    /// 图中采集节点 id。
    node_id: String,
    /// 写入请求: {correlationId, deadlineUnixNs, idempotencyKey?, items:[{pointId, value}]}。
    request: Value,
}

/// 运行控制动作入参。
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
enum RunActionDto {
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
#[derive(Debug, Deserialize, JsonSchema)]
struct RunWorkspaceParams {
    /// 目标动作。
    action: RunActionDto,
}

/// 构造采集控制能力节点。
#[must_use]
pub fn node() -> CapabilityNode {
    CapabilityNode {
        id: "acquisition",
        title_zh: "采集端点与运行控制",
        title_en: "Acquisition endpoints & run control",
        summary_zh: "端点开闭、设备树/驱动目录、点位读写、工作区运行控制",
        summary_en: "Endpoint open/close, device tree & driver manifests, point read/write, run control",
        tools: vec![
            tool0(
                "list_endpoints",
                "列出全部已打开采集端点快照 (含能力/点位/连接参数)。连接前先用它确认状态",
                |ctx| async move { Ok(ToolOutput::Json(control::list_endpoints(&ctx.toolbox))) },
            ),
            tool0(
                "list_device_tree_nodes",
                "列出生产设备树节点身份、路径、驱动、状态和运行时能力投影",
                |ctx| async move {
                    Ok(ToolOutput::Json(control::list_device_tree_nodes(
                        &ctx.toolbox,
                    )))
                },
            ),
            tool0(
                "list_driver_manifests",
                "列出 NodeDriver 的角色、配置 schema、能力与 typed 端口目录",
                |ctx| async move {
                    Ok(ToolOutput::Json(control::list_driver_manifests(
                        &ctx.toolbox,
                    )))
                },
            ),
            tool(
                "open_endpoint",
                "按图中设备树节点 id 打开采集子树并挂载数据平面读任务。成功返回节点快照",
                |ctx, p: NodeIdParams| async move {
                    json_result(control::open_endpoint(&ctx.toolbox, &ctx.sink, &p.node_id).await)
                },
            ),
            tool(
                "close_endpoint",
                "关闭采集节点 (node_id 为图中 Acquisition 节点 id)",
                |ctx, p: NodeIdParams| async move {
                    json_result(
                        control::close_endpoint(&ctx.toolbox, ctx.sink.as_ref(), &p.node_id).await,
                    )
                },
            ),
            tool(
                "read_points",
                "读取指定采集节点的点位值 (point_ids 为点位 id 数组)。返回 {batch: {samples: [...]}}",
                |ctx, p: ReadPointsParams| async move {
                    let point_ids = p
                        .point_ids
                        .into_iter()
                        .map(points::PointId)
                        .collect::<Vec<_>>();
                    json_result(control::read_points(&ctx.toolbox, &p.node_id, point_ids).await)
                },
            ),
            tool(
                "write_points",
                "写入指定采集节点的点位值。request 为 WriteRequest JSON: {correlationId, deadlineUnixNs, idempotencyKey?, items:[{pointId, value}]}",
                |ctx, p: WritePointsParams| async move {
                    let request: points::WriteRequest = serde_json::from_value(p.request)
                        .map_err(|e| ToolError::InvalidParams(format!("request: {e}")))?;
                    json_result(control::write_points(&ctx.toolbox, &p.node_id, request).await)
                },
            ),
            tool(
                "run_workspace",
                "工作区运行控制: start (启动/恢复) / pause / stop。返回 {state, epoch}; 启动后采集与图求值才处理数据",
                |ctx, p: RunWorkspaceParams| async move {
                    json_result(
                        control::run_workspace(&ctx.toolbox, ctx.sink.as_ref(), p.action.into())
                            .await,
                    )
                },
            ),
        ],
        skills: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 节点声明 8 个工具。
    #[test]
    fn node_declares_tools() {
        let n = node();
        let names: Vec<_> = n.tools.iter().map(|t| t.name).collect();
        assert_eq!(
            names,
            vec![
                "list_endpoints",
                "list_device_tree_nodes",
                "list_driver_manifests",
                "open_endpoint",
                "close_endpoint",
                "read_points",
                "write_points",
                "run_workspace",
            ]
        );
    }

    /// 动作枚举按 snake_case 反序列化。
    #[test]
    fn run_action_deserializes() {
        let params: RunWorkspaceParams =
            serde_json::from_value(serde_json::json!({"action": "pause"})).expect("合法动作");
        assert!(matches!(params.action, RunActionDto::Pause));
    }
}
