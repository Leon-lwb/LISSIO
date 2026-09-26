//! 节点描述用例 — 配置与拓扑的完整端口投影。
//!
//! 仅分析配置与拓扑: 不要求整图编译成功、不执行脚本、不打开设备、不修改
//! 工作区。一次请求内某节点参数不完整不阻断其他节点; 不能确定的端口用
//! incomplete 表达, 不冒充权威空表。
//!
//! 数据域转换穷尽处理 — `kind::ports::PortDomain` 与 wire 词表是同一枚举
//! (`data_model::model_descriptor::NodePortDomain`), 无第二套转换。

// 目录排序值等有界索引转换 — 统一豁免逐个标注的噪音。
#![allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]

use data_model::model_descriptor::{ModelIssue, NodePortDescriptor, NodePortDomain};
use kind::document::NodeDocument;
use serde::Serialize;
use serde_json::Value;

use crate::models::issue;

/// 一次描述批请求。
#[derive(Debug, Clone, serde::Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DescribeRequest {
    /// 待描述文档 (含父设备草稿 — 批内父子拓扑)。
    pub documents: Vec<NodeDocument>,
    /// 相关边 (RawData src:* 动态端口与连线数推断用)。
    pub edges: Vec<GraphEdgeRef>,
    /// 请求侧版本号 (响应原样携带, 前端丢弃过期描述)。
    pub request_revision: u64,
}

/// 描述用边引用 (与图提交的 GraphEdge 同形, 只取描述所需字段)。
#[derive(Debug, Clone, serde::Deserialize, Serialize, ts_rs::TS)]
pub struct GraphEdgeRef {
    pub source: String,
    #[serde(default)]
    pub source_handle: Option<String>,
    pub target: String,
    #[serde(default)]
    pub target_handle: Option<String>,
}

/// 单节点描述结果。
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct NodeDescription {
    pub node_id: String,
    pub request_revision: u64,
    pub status: NodeDescriptionStatus,
    pub inputs: Vec<NodePortDescriptor>,
    pub outputs: Vec<NodePortDescriptor>,
    /// 默认输入/输出 handle (与历史 SourceNodeHint 语义一致, 由同一解析生成)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_input: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_output: Option<String>,
    /// Protocol 节点的生效通道数 (其他节点 None)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_channels: Option<usize>,
    /// RawData 等拓扑语义提示 — 前端不按 kind 名推断。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<NodeHint>,
    pub issues: Vec<ModelIssue>,
}

/// 拓扑语义提示。
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NodeHint {
    /// RawData 路由: 每个已连接 (source, sourceHandle) 一个输入端口。
    RawDataRouting,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub enum NodeDescriptionStatus {
    /// 描述完整可用。
    Ready,
    /// 配置不完整 (如 Custom 缺 customPorts) — 能确定的端口照常返回。
    Incomplete,
    /// 未知模型/驱动 — 保留原始文档, 由前端进入 Unsupported 展示。
    Unsupported,
}

/// 批量描述结果。
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct DescribeResult {
    pub request_revision: u64,
    pub nodes: Vec<NodeDescription>,
}

/// 描述一批文档。`request_revision` 原样回传。
pub fn describe_documents(request: &DescribeRequest) -> DescribeResult {
    let nodes = request
        .documents
        .iter()
        .map(|document| describe_one(document, request))
        .collect();
    DescribeResult {
        request_revision: request.request_revision,
        nodes,
    }
}

fn describe_one(document: &NodeDocument, request: &DescribeRequest) -> NodeDescription {
    let request_revision = request.request_revision;
    let node_id = document.id.clone();
    let base = |issues: Vec<ModelIssue>, inputs, outputs| NodeDescription {
        node_id: node_id.clone(),
        request_revision,
        status: NodeDescriptionStatus::Ready,
        inputs,
        outputs,
        default_input: None,
        default_output: None,
        effective_channels: None,
        hint: None,
        issues,
    };

    match &document.business {
        kind::document::NodeBusiness::Device { node: _ } => {
            // 设备节点端口是运行时投影 — 静态描述只声明角色, 完整端口由
            // capability API / 描述扩展提供 (与现有 graph:derived 输出口一致)
            base(
                vec![issue(
                    "device/ports-runtime",
                    None,
                    "device ports come from the capability projection, not static analysis",
                    data_model::model_descriptor::IssueSeverity::Info,
                )],
                Vec::new(),
                Vec::new(),
            )
        }
        kind::document::NodeBusiness::PointSelector { points } => base(
            Vec::new(),
            Vec::new(),
            points
                .iter()
                .map(|point| port(point.clone(), NodePortDomain::F32))
                .collect(),
        ),
        kind::document::NodeBusiness::Protocol {
            protocol, schema, ..
        } => {
            let names: Vec<String> = schema.port_names();
            let channels = names.len();
            let (inputs, outputs) = if names.is_empty() {
                (
                    Vec::new(),
                    vec![port("str".to_owned(), NodePortDomain::String)],
                )
            } else {
                (
                    Vec::new(),
                    names
                        .iter()
                        .map(|name| port(name.clone(), NodePortDomain::F32))
                        .collect(),
                )
            };
            let mut description = base(Vec::new(), inputs, outputs);
            description.effective_channels = Some(channels);
            description.default_input = Some("in".to_owned());
            description.default_output =
                Some(names.first().cloned().unwrap_or_else(|| "out".to_owned()));
            description
        }
        kind::document::NodeBusiness::Widget {
            widget_kind,
            params,
            custom_ports,
        } => {
            let mut issues = Vec::new();
            let Some(definition) = kind::widget_definition(widget_kind) else {
                issues.push(issue(
                    "widget/unsupported",
                    Some("widgetKind".to_owned()),
                    format!("unknown widget kind: {widget_kind}"),
                    data_model::model_descriptor::IssueSeverity::Error,
                ));
                return NodeDescription {
                    node_id: document.id.clone(),
                    request_revision,
                    status: NodeDescriptionStatus::Unsupported,
                    inputs: Vec::new(),
                    outputs: Vec::new(),
                    default_input: None,
                    default_output: None,
                    effective_channels: None,
                    hint: None,
                    issues,
                };
            };
            let table = definition.ports(params);
            let mut inputs: Vec<NodePortDescriptor> = table
                .inputs
                .iter()
                .map(|p| port(p.handle.clone(), p.domain))
                .collect();
            let outputs: Vec<NodePortDescriptor> = table
                .outputs
                .iter()
                .map(|p| port(p.handle.clone(), p.domain))
                .collect();

            // Custom: 端口声明是文档级合同; 缺失 = incomplete (不伪造默认口)
            if widget_kind == "Custom" {
                match custom_ports {
                    Some(ports) => {
                        inputs = ports
                            .inputs
                            .iter()
                            .map(|handle| port(handle.clone(), NodePortDomain::F32))
                            .collect();
                        return NodeDescription {
                            node_id: document.id.clone(),
                            request_revision,
                            status: NodeDescriptionStatus::Ready,
                            inputs,
                            outputs: ports
                                .outputs
                                .iter()
                                .map(|handle| port(handle.clone(), NodePortDomain::F32))
                                .collect(),
                            default_input: None,
                            default_output: None,
                            effective_channels: None,
                            hint: None,
                            issues,
                        };
                    }
                    None => {
                        issues.push(issue(
                            "custom/ports-missing",
                            Some("customPorts".to_owned()),
                            "custom widget port declaration missing",
                            data_model::model_descriptor::IssueSeverity::Warning,
                        ));
                        return NodeDescription {
                            node_id: document.id.clone(),
                            request_revision,
                            status: NodeDescriptionStatus::Incomplete,
                            inputs,
                            outputs: Vec::new(),
                            default_input: None,
                            default_output: None,
                            effective_channels: None,
                            hint: None,
                            issues,
                        };
                    }
                }
            }

            // RawData: 动态 src:* 端口由连线派生; 未连接回退单默认口
            if widget_kind == "RawData" {
                let derived = derive_raw_data_ports(&document.id, &request.edges);
                if let Some(inputs) = derived {
                    let mut description = base(issues, inputs, outputs);
                    description.hint = Some(NodeHint::RawDataRouting);
                    description.default_input =
                        description.inputs.first().map(|p| p.handle.clone());
                    return description;
                }
            }

            // 历史 default-handle 规则 (与 graph_ops::document 的 SourceNodeHint 同源):
            // 输入控件 default_output = 第一个输出口; 显示控件 default_input = 第一个输入口
            let mut description = base(issues, inputs, outputs);
            description.default_input = default_handle_for(widget_kind, &description.inputs, true);
            description.default_output =
                default_handle_for(widget_kind, &description.outputs, false);
            description.effective_channels = effective_channels_for(widget_kind, params);
            description
        }
    }
}

/// RawData 动态输入端口 — 每个指向本节点的 (source, sourceHandle) 唯一组合
/// 一个 `src:<sourceId>:<sourceHandle>` 端口; 无连线时 None (调用方回退
/// 默认 "data" 口)。
fn derive_raw_data_ports(node_id: &str, edges: &[GraphEdgeRef]) -> Option<Vec<NodePortDescriptor>> {
    let mut seen = std::collections::BTreeSet::new();
    let mut inputs = Vec::new();
    for edge in edges.iter().filter(|edge| edge.target == node_id) {
        let handle = edge
            .source_handle
            .clone()
            .unwrap_or_else(|| "data".to_owned());
        let key = format!("src:{}:{}", edge.source, handle);
        if seen.insert(key) {
            let domain = if handle == "rx" || handle == "out" {
                NodePortDomain::Bytes
            } else {
                NodePortDomain::F32
            };
            inputs.push(NodePortDescriptor {
                handle: format!("src:{}:{}", edge.source, handle),
                label: handle,
                domain,
                connect_domains: Vec::new(),
                dynamic: true,
                max_connections: None,
            });
        }
    }
    if inputs.is_empty() {
        None
    } else {
        Some(inputs)
    }
}

const fn port(handle: String, domain: NodePortDomain) -> NodePortDescriptor {
    NodePortDescriptor {
        handle,
        label: String::new(),
        domain,
        connect_domains: Vec::new(),
        dynamic: false,
        max_connections: None,
    }
}

/// 历史 SourceNodeHint 规则的统一实现 — 图提交与描述共用, 删除第二份 switch。
/// 语义: 输入侧优先业务命名口, 输出侧优先业务命名口, 否则回退第一个端口。
pub fn default_handle_for(
    widget_kind: &str,
    ports: &[NodePortDescriptor],
    is_input: bool,
) -> Option<String> {
    let preferred = if is_input {
        match widget_kind {
            "Math" | "Filter" | "FFT" => Some("in0"),
            "IFFT" | "Spectrum" => Some("spectrum"),
            "TextDisplay" | "TextOut" => Some("text"),
            "Trigger" => Some("trigger"),
            "RawData" => Some("data"),
            "Waveform" | "PieChart" | "Image" | "Gauge" | "Progress" | "LED" | "NumberDisplay"
            | "Label" | "Model3D" | "Command" | "TableView" => Some("value"),
            _ => None,
        }
    } else {
        match widget_kind {
            "Knob" | "Slider" | "Button" | "Radio" | "Checkbox" => Some("value"),
            "Math" | "Filter" => Some("result"),
            "FFT" => Some("spectrum"),
            "IFFT" => Some("out0"),
            "TextInput" => Some("str"),
            "Trigger" => Some("value"),
            _ => None,
        }
    };
    preferred
        .map(str::to_owned)
        .or_else(|| ports.first().map(|p| p.handle.clone()))
}

/// Waveform 的 channels 数 (渲染 CH0..N 端口数与描述一致性)。
fn effective_channels_for(widget_kind: &str, params: &Value) -> Option<usize> {
    match widget_kind {
        "Waveform" => Some(params.get("channels").and_then(Value::as_i64).unwrap_or(0) as usize),
        "PieChart" => Some(
            params
                .get("segments")
                .and_then(Value::as_array)
                .map_or(0, Vec::len),
        ),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
