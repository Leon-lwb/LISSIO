//! 能力注册表 → rmcp 工具路由适配器。
//!
//! 每个注册表工具经 `ToolRoute::new_dyn` 动态注册 (运行期构建, 会话克隆共享);
//! 调用时把 `ToolCallContext` 转成 [`ToolContext`] 委托注册表处理器,结果与
//! 错误映射为 MCP 协议形状。执行失败返回 `CallToolResult::error` (AI 客户端
//! 可见失败原因),参数错误映射协议层 invalid params。

use std::sync::Arc;

use control_api::Toolbox;
use control_api::capabilities::registry::CapabilityRegistry;
use control_api::capabilities::skill::Lang;
use control_api::capabilities::tool::{ToolContext, ToolDefinition, ToolOutput};
use events::EventSinkHandle;
use rmcp::handler::server::router::tool::{ToolRoute, ToolRouter};
use rmcp::handler::server::tool::ToolCallContext;
use rmcp::model::{CallToolResult, ContentBlock, Tool};
use serde_json::Value;

use super::VofaMcpServer;

/// 从能力注册表构建 rmcp 工具路由 — 注册表即工具清单的单一事实来源。
pub(super) fn build_router(
    registry: &Arc<CapabilityRegistry>,
    toolbox: Toolbox,
    sink: EventSinkHandle,
) -> ToolRouter<VofaMcpServer> {
    let mut router = ToolRouter::new();
    for (_, def) in registry.tools() {
        router.add_route(tool_route(
            Arc::clone(registry),
            toolbox.clone(),
            sink.clone(),
            def,
        ));
    }
    router
}

/// 注册表工具声明 → rmcp 工具路由项。
fn tool_route(
    registry: Arc<CapabilityRegistry>,
    toolbox: Toolbox,
    sink: EventSinkHandle,
    def: &ToolDefinition,
) -> ToolRoute<VofaMcpServer> {
    let attr = Tool::new(def.name, def.description, schema_object(def));
    let def = def.clone();
    ToolRoute::new_dyn(attr, move |context: ToolCallContext<'_, VofaMcpServer>| {
        let def = def.clone();
        let ctx = ToolContext {
            registry: Arc::clone(&registry),
            toolbox: toolbox.clone(),
            sink: Arc::clone(&sink),
            lang: Lang::Zh,
        };
        let arguments = context.arguments.map_or_else(|| Value::Null, Value::Object);
        Box::pin(async move {
            match def.invoke(ctx, arguments).await {
                Ok(ToolOutput::Json(v)) => match ContentBlock::json(v) {
                    Ok(content) => Ok(CallToolResult::success(vec![content]).into()),
                    Err(e) => {
                        Ok(CallToolResult::error(vec![ContentBlock::text(e.to_string())]).into())
                    }
                },
                Ok(ToolOutput::Text(s)) => {
                    Ok(CallToolResult::success(vec![ContentBlock::text(s)]).into())
                }
                Err(e) if e.is_invalid_params() => {
                    Err(rmcp::ErrorData::invalid_params(e.to_string(), None))
                }
                Err(e) => Ok(CallToolResult::error(vec![ContentBlock::text(e.to_string())]).into()),
            }
        })
    })
}

/// 工具 schema → rmcp JSON 对象 (注册表构造已校验为对象, 兜底空对象)。
fn schema_object(def: &ToolDefinition) -> serde_json::Map<String, Value> {
    def.input_schema.as_object().cloned().unwrap_or_default()
}

#[cfg(test)]
#[path = "router_tests.rs"]
mod tests;
