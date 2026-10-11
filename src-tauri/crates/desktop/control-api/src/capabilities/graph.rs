//! 图编辑能力节点 — 图文档替换 / 增量连线 / 控件赋值 / 输出快照。
//!
//! 自带文档: 节点与控件类型参考 (nodes-reference)。

use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use super::node::CapabilityNode;
use super::skill::SkillDoc;
use super::tool::{ToolOutput, json_result, tool, tool0};
use crate::tools;

/// 输入控件赋值入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct SetInputValueParams {
    /// 控件节点 id。
    widget_id: String,
    /// 目标值。
    value: f32,
}

/// 图更新参数 — documents/edges 为前端同构的 JSON (`NodeDocument` / `Edge`)。
#[derive(Debug, Deserialize, JsonSchema)]
struct UpdateGraphParams {
    /// 目标 tab id。
    tab_id: String,
    /// 完整节点文档: id, tabId, label, layout, kind, config, attributes。
    documents: Vec<Value>,
    /// 连线列表。
    edges: Vec<Value>,
}

/// 连线入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct ConnectEdgeParams {
    /// 源节点 id。
    source: String,
    /// 目标节点 id。
    target: String,
    /// 归属 tab (缺省自动定位: 优先同时持有两端的 tab)。
    tab_id: Option<String>,
    /// 源端口 id (缺省按端口提示/节点类型补默认, 如 rx / out)。
    source_handle: Option<String>,
    /// 目标端口 id (缺省按端口提示/节点类型补默认, 如 in)。
    target_handle: Option<String>,
}

/// 删线入参 — edge_id 或 source/target 至少给一个。
#[derive(Debug, Deserialize, JsonSchema)]
struct DisconnectEdgeParams {
    /// 连线 id (优先精确匹配)。
    edge_id: Option<String>,
    /// 源节点 id (与 target 组合过滤, 可只给一端)。
    source: Option<String>,
    /// 目标节点 id。
    target: Option<String>,
}

/// 节点与控件类型参考文档。
const fn nodes_reference_doc() -> SkillDoc {
    SkillDoc {
        id: "nodes-reference",
        title_zh: "节点与控件类型参考",
        title_en: "Node & Widget Type Reference",
        summary_zh: "传输/协议类型与参数、全部 widget、连线规则与端口域 (同域才能连)",
        summary_en: "Transport/protocol kinds & params, all widgets, wiring rules & port domains",
        md_zh: include_str!("docs/zh/nodes-reference.md"),
        md_en: include_str!("docs/en/nodes-reference.md"),
    }
}

/// 构造图编辑能力节点。
#[must_use]
pub fn node() -> CapabilityNode {
    CapabilityNode {
        id: "graph",
        title_zh: "节点图编辑",
        title_en: "Node graph editing",
        summary_zh: "整图替换与增量连线 (后端编译校验)、控件赋值、图输出快照",
        summary_en: "Whole-graph replace & incremental wiring (compiled), widget input, output snapshot",
        tools: vec![
            tool(
                "set_input_value",
                "设置节点图输入控件的值 (widget_id 为控件节点 id)。立即生效并触发一次求值",
                |ctx, p: SetInputValueParams| async move {
                    Ok(ToolOutput::Json(tools::set_input_value(
                        &ctx.toolbox,
                        &p.widget_id,
                        p.value,
                    )))
                },
            ),
            tool0(
                "get_graph_outputs",
                "读取节点图输出快照: {widgetId: {portId: value}}。用于观察控件/波形/计算节点的实时输出",
                |ctx| async move { Ok(ToolOutput::Json(tools::get_graph_outputs(&ctx.toolbox))) },
            ),
            tool0(
                "list_tabs",
                "列出已提交节点图的 tab id 列表 (配合 update_graph 使用)",
                |ctx| async move { Ok(ToolOutput::Json(tools::list_tabs(&ctx.toolbox))) },
            ),
            tool(
                "update_graph",
                "原子替换指定 tab 的节点文档和连线。documents 使用 id/tabId/label/layout/kind/config/attributes 公共契约。提交成功后画布、运行图和持久化同时更新；编译失败时旧文档保留",
                |ctx, p: UpdateGraphParams| async move {
                    json_result(
                        tools::update_graph(
                            &ctx.toolbox,
                            ctx.sink.as_ref(),
                            &p.tab_id,
                            p.documents,
                            p.edges,
                            None,
                        )
                        .await,
                    )
                },
            ),
            tool(
                "connect_edge",
                "在两个节点端口间建立连线。handle 缺省时自动补默认端口;RawData 控件目标自动改写 src: 端口。端口域不匹配或成环等编译失败返回真实原因且不建边; 成功返回 {edge_id} 并实时同步到界面",
                |ctx, p: ConnectEdgeParams| async move {
                    json_result(
                        tools::connect_edge(
                            &ctx.toolbox,
                            ctx.sink.as_ref(),
                            p.tab_id,
                            &p.source,
                            &p.target,
                            p.source_handle,
                            p.target_handle,
                        )
                        .await,
                    )
                },
            ),
            tool(
                "disconnect_edge",
                "删除连线: 给 edge_id 精确删除, 或给 source/target (可只给一端) 删除第一条匹配。成功返回被删边信息并实时同步到界面",
                |ctx, p: DisconnectEdgeParams| async move {
                    json_result(
                        tools::disconnect_edge(
                            &ctx.toolbox,
                            ctx.sink.as_ref(),
                            p.edge_id,
                            p.source,
                            p.target,
                        )
                        .await,
                    )
                },
            ),
        ],
        skills: vec![nodes_reference_doc()],
    }
}

#[cfg(test)]
#[path = "graph_tests.rs"]
mod tests;
