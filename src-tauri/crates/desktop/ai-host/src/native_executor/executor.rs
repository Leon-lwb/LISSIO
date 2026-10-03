//! 原生工具执行器本体 — 注册表后端直连, 前端托管兜底。
//!
//! 后端能力工具 (数据读取/设备发送/连线/知识库等) 经
//! [`control_api::capabilities::CapabilityRegistry`] 动态派发, 与对外 MCP
//! server 走同一份工具定义与实现; 前端托管工具 (画布/UI 状态操作) 经
//! `ai_tool_invoke` 事件桥由前端 `toolHost` 执行。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chat::ToolExecutor;
use control_api::Toolbox;
use control_api::capabilities::registry::CapabilityRegistry;
use control_api::capabilities::skill::Lang;
use control_api::capabilities::tool::ToolContext;
use error::{AppError, McpError, Result};
use events::EventSinkHandle;
use llm::ToolSpecDto;
use parking_lot::Mutex;
use serde_json::{Value, json};
use tokio::sync::oneshot;

use super::frontend;

/// 前端托管工具调用事件名 (前端 `toolHost.ts` 监听)。
pub const AI_TOOL_INVOKE_EVENT: &str = "ai_tool_invoke";

/// 前端托管工具执行超时 (网页抓取上限 15s, 留出前端解析余量)。
const FRONTEND_TOOL_TIMEOUT: Duration = Duration::from_secs(20);

/// 前端托管工具调用回执。
pub enum ToolOutcome {
    /// 成功 (工具结果字符串)。
    Ok(String),
    /// 失败 (错误描述)。
    Err(String),
}

/// pending 前端调用注册表 — call_id → 回执发送端 (`ai_tool_resolve` 消费)。
pub type PendingCalls = Arc<Mutex<HashMap<String, oneshot::Sender<ToolOutcome>>>>;

/// Independent visibility for software tools and the Web skill.
#[derive(Debug, Clone, Copy)]
pub struct NativeToolOptions {
    /// Software capabilities and built-in frontend tools.
    pub builtin: bool,
    /// `fetch_webpage` Web skill.
    pub web: bool,
}

/// 构造工具失败错误。
fn tool_failed(tool: &str, details: impl Into<String>) -> AppError {
    McpError::ToolFailed {
        tool: tool.to_string(),
        details: details.into(),
    }
    .into()
}

/// 原生工具执行器 — 内置 AI 调用软件自有能力的桥梁。
pub struct NativeToolExecutor {
    /// 软件能力注册表 (后端工具单一事实来源)。
    registry: Arc<CapabilityRegistry>,
    toolbox: Toolbox,
    /// 事件端口 — 后端能力 (字节注入/连线) 复用与 MCP server 同一份实现。
    sink: EventSinkHandle,
    /// 当前出口的前端事件端口。WebSocket 出口可为连接级实现。
    frontend: EventSinkHandle,
    pending: PendingCalls,
    lang: Lang,
    options: NativeToolOptions,
}

impl NativeToolExecutor {
    /// 构造。注册表、业务状态、后端事件与前端事件均由组合根注入。
    #[must_use]
    pub fn new(
        registry: Arc<CapabilityRegistry>,
        toolbox: Toolbox,
        sink: EventSinkHandle,
        frontend: EventSinkHandle,
        pending: PendingCalls,
        lang: Lang,
        options: NativeToolOptions,
    ) -> Self {
        Self {
            registry,
            toolbox,
            sink,
            frontend,
            pending,
            lang,
            options,
        }
    }

    /// 是否处理该工具 (内置优先于外部 MCP)。
    #[must_use]
    pub fn handles(&self, name: &str) -> bool {
        (self.options.builtin
            && (self.registry.find_tool(name).is_some()
                || frontend::is_builtin_frontend_tool(name)))
            || (self.options.web && frontend::is_web_tool(name))
    }

    /// 前端托管调用: 发事件 + 等回执 (超时兜底)。
    async fn call_frontend(&self, name: &str, arguments: Value) -> Result<String> {
        let call_id = control_api::tools::next_call_id();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(call_id.clone(), tx);

        let payload = json!({ "call_id": call_id, "name": name, "arguments": arguments });
        self.frontend.emit_event(AI_TOOL_INVOKE_EVENT, payload);

        match tokio::time::timeout(FRONTEND_TOOL_TIMEOUT, rx).await {
            Ok(Ok(ToolOutcome::Ok(content))) => Ok(content),
            Ok(Ok(ToolOutcome::Err(details))) => Err(tool_failed(name, details)),
            Ok(Err(_dropped)) => {
                self.pending.lock().remove(&call_id);
                Err(tool_failed(name, "前端未回执 (界面不可用)"))
            }
            Err(_timeout) => {
                self.pending.lock().remove(&call_id);
                Err(tool_failed(name, "前端执行超时 (15s)"))
            }
        }
    }

    /// 注册表后端工具调用上下文。
    fn context(&self) -> ToolContext {
        ToolContext {
            registry: Arc::clone(&self.registry),
            toolbox: self.toolbox.clone(),
            sink: Arc::clone(&self.sink),
            lang: self.lang,
        }
    }
}

#[async_trait::async_trait]
impl ToolExecutor for NativeToolExecutor {
    fn tools(&self) -> Vec<ToolSpecDto> {
        let mut specs = Vec::new();
        if self.options.builtin {
            // 后端能力工具从注册表派生 (与 MCP server 同一 schema/描述),
            // 内置前端托管工具补充在后。
            specs.extend(self.registry.tools().map(|(_, t)| ToolSpecDto {
                name: t.name.to_string(),
                description: t.description.to_string(),
                input_schema: t.input_schema.clone(),
            }));
            specs.extend(frontend::builtin_frontend_tool_specs());
        }
        if self.options.web {
            specs.extend(frontend::web_tool_specs());
        }
        specs
    }

    async fn call(&self, name: &str, arguments: Value) -> Result<String> {
        // 注册表后端直连优先, 未命中走对应的前端托管分组。
        if self.options.builtin
            && let Some((_, def)) = self.registry.find_tool(name)
        {
            let out = def
                .invoke(self.context(), arguments)
                .await
                .map_err(|e| tool_failed(name, e.to_string()))?;
            return Ok(out.to_text());
        }
        if (self.options.builtin && frontend::is_builtin_frontend_tool(name))
            || (self.options.web && frontend::is_web_tool(name))
        {
            return self.call_frontend(name, arguments).await;
        }
        Err(tool_failed(name, "未知内置工具"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn executor() -> NativeToolExecutor {
        NativeToolExecutor::new(
            Arc::new(CapabilityRegistry::builtin()),
            Toolbox::from_state(&app::AppState::new()),
            Arc::new(events::NullEventSink),
            Arc::new(events::NullEventSink),
            Arc::new(Mutex::new(HashMap::new())),
            Lang::Zh,
            NativeToolOptions {
                builtin: true,
                web: true,
            },
        )
    }

    /// 规格清单 = 注册表工具 + 前端托管工具, 无重名。
    #[test]
    fn specs_derive_from_registry() {
        let executor = executor();
        let registry_count = executor.registry.tools().count();
        let specs = executor.tools();
        let mut seen = std::collections::HashSet::new();
        for t in &specs {
            assert!(seen.insert(t.name.clone()), "重复工具名: {}", t.name);
        }
        assert_eq!(
            specs.len(),
            registry_count + frontend::BUILTIN_FRONTEND_TOOLS.len() + frontend::WEB_TOOLS.len()
        );
        assert!(seen.contains("read_skill"));
        assert!(seen.contains("connect_edge"));
        assert!(seen.contains("fetch_webpage"));
        assert!(
            !seen.contains("connect_nodes"),
            "旧名 connect_nodes 应并入 connect_edge"
        );
    }

    /// 注册表工具经执行器调用: read_skill 命中知识库节点。
    #[tokio::test]
    async fn dispatches_registry_tools() {
        let executor = executor();
        let out = executor
            .call("read_skill", json!({"skill_id": "overview"}))
            .await
            .expect("read_skill 应命中注册表");
        assert!(out.len() > 200);
    }

    /// 参数错误与未知工具都映射为工具失败。
    #[tokio::test]
    async fn unknown_and_invalid_report_tool_failure() {
        let executor = executor();
        assert!(executor.call("nope", json!({})).await.is_err());
        assert!(
            executor
                .call("read_skill", json!({"skill_id": "不存在"}))
                .await
                .is_err()
        );
    }

    /// handles 覆盖注册表与前端两组工具。
    #[test]
    fn handles_covers_both_groups() {
        let executor = executor();
        assert!(executor.handles("send_bytes"));
        assert!(executor.handles("add_node"));
        assert!(executor.handles("fetch_webpage"));
        assert!(!executor.handles("nope"));
    }

    #[test]
    fn builtin_and_web_sources_are_independent() {
        let make = |builtin, web| {
            NativeToolExecutor::new(
                Arc::new(CapabilityRegistry::builtin()),
                Toolbox::from_state(&app::AppState::new()),
                Arc::new(events::NullEventSink),
                Arc::new(events::NullEventSink),
                Arc::new(Mutex::new(HashMap::new())),
                Lang::Zh,
                NativeToolOptions { builtin, web },
            )
        };
        let web_only = make(false, true);
        assert!(web_only.handles("fetch_webpage"));
        assert!(!web_only.handles("read_skill"));
        assert!(!web_only.handles("add_node"));
        assert_eq!(web_only.tools().len(), 1);

        let builtin_only = make(true, false);
        assert!(!builtin_only.handles("fetch_webpage"));
        assert!(builtin_only.handles("read_skill"));
        assert!(builtin_only.handles("add_node"));
        assert!(
            !builtin_only
                .tools()
                .iter()
                .any(|tool| tool.name == "fetch_webpage")
        );
    }
}
