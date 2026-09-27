//! MCP server 实现 — rmcp 工具 handler 与 HTTP 生命周期。
//!
//! 工具路由从 [`control_api::capabilities::CapabilityRegistry`] 运行期动态构建
//! (见 [`router`]);工具实现与状态切片在 [`control_api`],本模块只做协议适配、
//! HTTP 宿主与监听端口配置。

mod router;
mod runtime;

pub use runtime::{DEFAULT_MCP_PORT, MCP_PORT_ENV, McpServerHandle, resolve_port, start};

use std::sync::Arc;

use control_api::Toolbox;
use control_api::capabilities::registry::CapabilityRegistry;
use control_api::capabilities::skill::Lang;
use events::EventSinkHandle;
use rmcp::ServerHandler;
use rmcp::handler::server::router::tool::ToolRouter;

/// MCP HTTP 端点路径 (外部客户端配置的 URL 需指向它)。
pub const MCP_ENDPOINT_PATH: &str = "/mcp";

/// MCP server handler — 工具路由由能力注册表动态派生。
#[derive(Clone)]
pub struct VofaMcpServer {
    registry: Arc<CapabilityRegistry>,
    toolbox: Toolbox,
    sink: EventSinkHandle,
    /// 动态构建的完整工具路由。
    tool_router: ToolRouter<Self>,
}

impl VofaMcpServer {
    /// 构造 handler — 每个会话一份, 路由克隆共享。
    #[must_use]
    pub fn new(registry: Arc<CapabilityRegistry>, toolbox: Toolbox, sink: EventSinkHandle) -> Self {
        let tool_router = router::build_router(&registry, toolbox.clone(), sink.clone());
        Self {
            registry,
            toolbox,
            sink,
            tool_router,
        }
    }

    /// 服务端 instructions — 静态简介 + 从注册表组装的能力域与工具索引。
    #[must_use]
    pub fn instructions(&self) -> String {
        compose_instructions(&self.registry)
    }
}

/// 组装 instructions:概览 + 各能力域的工具清单 (与注册表同步, 不手写第二份)。
fn compose_instructions(registry: &CapabilityRegistry) -> String {
    use std::fmt::Write as _;
    let mut out = String::from(
        "Lissio 串口/波形调试上位机。可打开设备 (open_endpoint)、启动采集 (run_workspace start)、\
         发送指令到设备 (send_string/send_bytes/send_can_frame)、读取波形与图输出\
         (get_recent_waveform/get_graph_outputs)、修改节点图 (update_graph 整图替换 / \
         connect_edge+disconnect_edge 增量连线, 编译校验失败会返回真实原因)、\
         读取使用知识库 (list_skills/read_skill)。\n可用能力域与工具:\n",
    );
    for node in registry.nodes() {
        let tools: Vec<&str> = node.tools.iter().map(|t| t.name).collect();
        // String 的 write! 实现不会失败, 直接忽略返回值
        let _ = writeln!(
            out,
            "- {} ({}): {}",
            node.title(Lang::Zh),
            node.id,
            tools.join(", ")
        );
    }
    out.push_str(
        "先用 list_devices/list_endpoints/list_data_sources/list_tabs/list_skills 了解可用资源。",
    );
    out
}

#[rmcp::tool_handler(router = self.tool_router)]
impl ServerHandler for VofaMcpServer {
    fn get_info(&self) -> rmcp::model::ServerInfo {
        rmcp::model::ServerInfo::new(
            rmcp::model::ServerCapabilities::builder()
                .enable_tools()
                .build(),
        )
        .with_server_info(rmcp::model::Implementation::new(
            "lissio",
            env!("CARGO_PKG_VERSION"),
        ))
        .with_instructions(self.instructions())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// instructions 覆盖全部注册表节点与其工具名。
    #[test]
    fn instructions_cover_registry() {
        let registry = Arc::new(CapabilityRegistry::builtin());
        let text = compose_instructions(&registry);
        for node in registry.nodes() {
            assert!(text.contains(node.id), "instructions 缺少节点 {}", node.id);
            for t in &node.tools {
                assert!(text.contains(t.name), "instructions 缺少工具 {}", t.name);
            }
        }
    }
}
