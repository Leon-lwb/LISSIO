//! 传输能力节点 — 设备会话查询 / 串口发现 / 字节发送与注入 / 原始字节读取。
//!
//! 自带文档: 协议与数据格式 (protocols)。

use schemars::JsonSchema;
use serde::Deserialize;

use super::node::CapabilityNode;
use super::skill::SkillDoc;
use super::tool::{ToolOutput, json_result, tool, tool0};
use crate::tools;

/// 发送字节的入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct SendBytesParams {
    /// 目标传输节点 id。
    node_id: String,
    /// 字节数组 (0-255)。
    data: Vec<u8>,
}

/// 发送文本的入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct SendStringParams {
    /// 目标传输节点 id。
    node_id: String,
    /// UTF-8 文本。
    text: String,
}

/// 字节注入入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct InjectBytesParams {
    /// 注入源节点 id (字节边起点)。
    source_node_id: String,
    /// 字节数组 (0-255)。
    data: Vec<u8>,
}

/// 原始字节读取入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct RawDataParams {
    /// 数据源节点 id (Transport 或 FrameDecoder)。
    source: String,
    /// 最大读取字节数 (上限 64KiB, 缺省 4096)。
    #[serde(default = "default_raw_bytes")]
    max_bytes: u32,
}

const fn default_raw_bytes() -> u32 {
    4096
}

/// 协议与数据格式文档。
const fn protocols_doc() -> SkillDoc {
    SkillDoc {
        id: "protocols",
        title_zh: "协议与数据格式",
        title_en: "Protocols & Data Formats",
        summary_zh: "JustFloat/FireWater 帧格式、自定义帧、CAN、逻辑解码",
        summary_en: "JustFloat/FireWater frames, custom frames, CAN, logic decode",
        md_zh: include_str!("docs/zh/protocols.md"),
        md_en: include_str!("docs/en/protocols.md"),
    }
}

/// 构造传输能力节点。
#[must_use]
pub fn node() -> CapabilityNode {
    CapabilityNode {
        id: "transport",
        title_zh: "设备传输与字节收发",
        title_en: "Device transport & byte I/O",
        summary_zh: "设备会话查询、串口发现、字节/文本发送、字节平面注入与原始字节读取",
        summary_en: "Device sessions, serial discovery, byte/text send, byte-plane inject, raw bytes",
        tools: vec![
            tool0(
                "list_devices",
                "列出全部已打开设备会话及其连接状态。返回 [{node_id, state}] 数组",
                |ctx| async move { Ok(ToolOutput::Json(tools::list_devices(&ctx.toolbox).await)) },
            ),
            tool0(
                "list_serial_ports",
                "列出系统可用串口 [{name, port_type, vid, pid, serial_number, manufacturer, product}]。连接串口前先用它确定端口名",
                |ctx| async move { json_result(tools::list_serial_ports(&ctx.toolbox)) },
            ),
            tool(
                "send_bytes",
                "向指定传输节点发送原始字节。data 为字节数组 (0-255)。返回发送字节数",
                |ctx, p: SendBytesParams| async move {
                    json_result(tools::send_bytes(&ctx.toolbox, &p.node_id, &p.data).await)
                },
            ),
            tool(
                "send_string",
                "向指定传输节点发送 UTF-8 文本 (按字节原样发送, 不自动加换行)。返回发送字节数",
                |ctx, p: SendStringParams| async move {
                    json_result(tools::send_string(&ctx.toolbox, &p.node_id, &p.text).await)
                },
            ),
            tool(
                "inject_bytes",
                "把字节从 source_node_id 注入全局字节平面, 路由到其下游 (协议解析/回环发送)。与设备无连接时也可用于协议调试。返回命中下游数量",
                |ctx, p: InjectBytesParams| async move {
                    json_result(
                        tools::inject_bytes(
                            &ctx.toolbox,
                            ctx.sink.as_ref(),
                            &p.source_node_id,
                            &p.data,
                        )
                        .await,
                    )
                },
            ),
            tool(
                "get_raw_data",
                "读取指定源 (Transport/FrameDecoder 节点 id) 最近收发的原始字节 (hex 编码, 含方向与时间戳)。排查设备是否有数据的第一工具",
                |ctx, p: RawDataParams| async move {
                    Ok(ToolOutput::Json(tools::get_raw_data(
                        &ctx.toolbox,
                        &p.source,
                        p.max_bytes,
                    )))
                },
            ),
        ],
        skills: vec![protocols_doc()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 节点声明完整性: 工具名与描述非空, 文档可读。
    #[test]
    fn node_declares_tools_and_docs() {
        let n = node();
        let names: Vec<_> = n.tools.iter().map(|t| t.name).collect();
        assert_eq!(
            names,
            vec![
                "list_devices",
                "list_serial_ports",
                "send_bytes",
                "send_string",
                "inject_bytes",
                "get_raw_data",
            ]
        );
        assert!(n.tools.iter().all(|t| !t.description.is_empty()));
        assert_eq!(n.skills.len(), 1);
        assert!(n.skills[0].md_zh.len() > 200);
    }
}
