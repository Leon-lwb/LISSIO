//! 前端托管工具清单 — 画布/UI 状态与网页预处理 (经事件桥由前端执行)。
//!
//! 后端能力工具 (数据读取/设备发送/连线/知识库等) 全部来自
//! [`control_api::capabilities::CapabilityRegistry`], 不在此重复声明;
//! 这里只保留依赖前端 zustand 画布状态的工具规格。

use llm::ToolSpecDto;
use serde_json::{Value, json};

/// 工具规格简写构造。
fn spec(name: &str, description: &str, properties: Value, required: &[&str]) -> ToolSpecDto {
    let mut schema = json!({
        "type": "object",
        "properties": properties,
    });
    if !required.is_empty() {
        schema["required"] = json!(required);
    }
    ToolSpecDto {
        name: name.to_string(),
        description: description.to_string(),
        input_schema: schema,
    }
}

/// 内置前端托管工具名集合 (与前端 `toolHost.ts` 实现一一对应)。
pub const BUILTIN_FRONTEND_TOOLS: &[&str] = &[
    "get_workspace",
    "add_node",
    "update_node_config",
    "remove_node",
    "move_node",
    "create_tab",
    "set_active_tab",
    "connect_device",
    "disconnect_device",
    "list_templates",
    "apply_template",
];

/// Web 技能工具名集合。
pub const WEB_TOOLS: &[&str] = &["fetch_webpage"];

/// 是否为软件内置前端工具。
pub fn is_builtin_frontend_tool(name: &str) -> bool {
    BUILTIN_FRONTEND_TOOLS.contains(&name)
}

/// 是否为 Web 技能工具。
pub fn is_web_tool(name: &str) -> bool {
    WEB_TOOLS.contains(&name)
}

/// 内置前端托管工具规格。
pub fn builtin_frontend_tool_specs() -> Vec<ToolSpecDto> {
    vec![
        spec(
            "get_workspace",
            "读取统一工作区文档: 活跃 tab，以及每个 tab 的 documents 与 edges。documents 使用 id/tabId/label/layout/kind/config/attributes 公共节点契约；运行时派生端口单独返回",
            json!({}),
            &[],
        ),
        spec(
            "add_node",
            "向指定 tab 添加 device / protocol / point-selector / widget 节点。返回新节点 id",
            json!({
                "type": {"type": "string", "enum": ["device", "protocol", "point-selector", "widget"], "description": "节点类别"},
                "kind": {"type": "string", "description": "device 使用能力目录 adapter id；protocol=JustFloat/FireWater/RawData/Slcan/CandleLight/LogicDecode；widget=Knob/Slider/Button/Waveform/Math/FrameDecoder/...；point-selector 可填任意非空占位值"},
                "tab_id": {"type": "string", "description": "节点归属 tab, 缺省当前活跃 tab"},
                "config": {"type": "object", "description": "配置 (可选, 与默认配置深合并)"},
                "position": {"type": "object", "description": "画布位置 {x, y}, 缺省自动排布", "properties": {"x": {"type": "number"}, "y": {"type": "number"}}}
            }),
            &["type", "kind"],
        ),
        spec(
            "update_node_config",
            "更新节点业务配置；device 更新驱动 payload，widget 更新 params，protocol 更新解析配置",
            json!({
                "node_id": {"type": "string", "description": "目标节点 id"},
                "config": {"type": "object", "description": "新配置 (部分或完整)"}
            }),
            &["node_id", "config"],
        ),
        spec(
            "remove_node",
            "删除页签内节点，自动清理其连线；设备节点会关闭会话",
            json!({"node_id": {"type": "string", "description": "目标节点 id"}}),
            &["node_id"],
        ),
        spec(
            "move_node",
            "移动节点画布位置 (纯视觉调整)",
            json!({
                "node_id": {"type": "string", "description": "目标节点 id"},
                "x": {"type": "number"}, "y": {"type": "number"}
            }),
            &["node_id", "x", "y"],
        ),
        spec(
            "create_tab",
            "新建控制页 (画布 tab)。返回 tab_id",
            json!({"name": {"type": "string", "description": "页名, 缺省自动编号"}}),
            &[],
        ),
        spec(
            "set_active_tab",
            "切换活跃控制页",
            json!({"tab_id": {"type": "string", "description": "目标 tab id"}}),
            &["tab_id"],
        ),
        spec(
            "connect_device",
            "打开设备节点会话；带测试属性时启动模拟源且不访问真实硬件",
            json!({"node_id": {"type": "string", "description": "设备节点 id"}}),
            &["node_id"],
        ),
        spec(
            "disconnect_device",
            "关闭设备节点会话",
            json!({"node_id": {"type": "string", "description": "设备节点 id"}}),
            &["node_id"],
        ),
        spec(
            "list_templates",
            "列出内置工作区模板 (id 与说明), 配合 apply_template 使用",
            json!({}),
            &[],
        ),
        spec(
            "apply_template",
            "一键应用内置工作区模板 (自动搭建传输→协议→显示链路)",
            json!({"template_id": {"type": "string", "description": "模板 id (先 list_templates 查询)"}}),
            &["template_id"],
        ),
    ]
}

/// Web 技能工具规格。
pub fn web_tool_specs() -> Vec<ToolSpecDto> {
    vec![spec(
        "fetch_webpage",
        "抓取 HTTP/HTTPS 网页并提取主要正文；返回标题、最终 URL、发布信息和去除导航/脚本/样式后的 Markdown。适合查询网页资料、文档和文章，不执行页面 JavaScript",
        json!({
            "url": {"type": "string", "description": "完整 HTTP/HTTPS 网页 URL"}
        }),
        &["url"],
    )]
}

#[cfg(test)]
#[path = "frontend_tests.rs"]
mod tests;
