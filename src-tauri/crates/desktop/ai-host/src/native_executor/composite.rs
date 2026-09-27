//! 组合工具执行器 — 注册表内置原生工具 + 外部 MCP server 聚合工具。
//!
//! 同名时内置优先;两者皆无时 `tools()` 为空,行为等同纯对话 (模型不会发起
//! 工具调用)。

use std::sync::Arc;

use chat::ToolExecutor;
use error::{McpError, Result};
use llm::ToolSpecDto;
use mcp_client::{McpManager, McpToolInfo};
use serde_json::Value;

use super::executor::NativeToolExecutor;

/// MCP 聚合工具执行器 — 对话循环调用外部 MCP 工具的桥梁。
pub struct McpToolExecutor {
    tools: Vec<McpToolInfo>,
    mcp: Arc<McpManager>,
}

impl McpToolExecutor {
    /// 以聚合工具快照与连接管理器构造。
    pub const fn new(tools: Vec<McpToolInfo>, mcp: Arc<McpManager>) -> Self {
        Self { tools, mcp }
    }
}

#[async_trait::async_trait]
impl ToolExecutor for McpToolExecutor {
    fn tools(&self) -> Vec<ToolSpecDto> {
        self.tools
            .iter()
            .map(|t| ToolSpecDto {
                name: t.prefixed_name.clone(),
                description: if t.description.is_empty() {
                    format!("{} 的工具 (server: {})", t.name, t.server_name)
                } else {
                    format!("{} (server: {})", t.description, t.server_name)
                },
                input_schema: t.input_schema.clone(),
            })
            .collect()
    }

    async fn call(&self, name: &str, arguments: Value) -> Result<String> {
        self.mcp.call_by_prefixed(name, arguments).await
    }
}

/// 组合执行器 — 内置原生工具 + 外部 MCP 工具;同名时内置优先。
pub struct CompositeExecutor {
    native: Option<NativeToolExecutor>,
    mcp: Option<McpToolExecutor>,
}

impl CompositeExecutor {
    /// 组合两组执行器 (任一可为 None, 表示该来源未启用)。
    pub const fn new(native: Option<NativeToolExecutor>, mcp: Option<McpToolExecutor>) -> Self {
        Self { native, mcp }
    }
}

#[async_trait::async_trait]
impl ToolExecutor for CompositeExecutor {
    fn tools(&self) -> Vec<ToolSpecDto> {
        let mut out = Vec::new();
        if let Some(n) = &self.native {
            out.extend(n.tools());
        }
        if let Some(m) = &self.mcp {
            out.extend(m.tools());
        }
        out
    }

    async fn call(&self, name: &str, arguments: Value) -> Result<String> {
        if let Some(n) = &self.native
            && n.handles(name)
        {
            return n.call(name, arguments).await;
        }
        if let Some(m) = &self.mcp {
            return m.call(name, arguments).await;
        }
        Err(McpError::ToolFailed {
            tool: name.to_string(),
            details: "工具不存在".to_string(),
        }
        .into())
    }
}
