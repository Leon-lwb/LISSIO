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

/// 一次描述批请求 — 与前端共享的**线缆合同类型** (`requestRevision` 等字段名即契约)。
///
/// 注意: 该类型的 `documents` 是整体的 `Vec<NodeDocument>`, 因此它的反序列化是
/// 全有全无的。线缆入口不得直接用本类型解码 (一条不合法即整批失败); 应先取
/// 文档原值再走 [`DescribeBatch::decode`]。本类型保留给已持有强类型文档的
/// 进程内调用方与 ts-rs 导出。
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
///
/// 命名**刻意**与图提交 DTO 一致 (snake_case: `source_handle` / `target_handle`),
/// 而不是本文件其余 DTO 的 camelCase —— 「与图提交同形」是它的定义。因此前端必须
/// 用 ts-rs 导出的 `GraphEdgeRef` 构造本字段, 不得手写等价的 camelCase 形状:
/// serde 默认忽略未知字段, 写错时 `sourceHandle` 会被静默丢弃、`source_handle`
/// 退化为 `None`, 而 RawData 的 `src:*` 动态端口正是由 `source_handle` 推导 ——
/// 表现为「RawData 端口丢失」且全程无任何报错。
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

/// 文档缺少可辨识 id 时的占位 — 前端据此把失败归因到「某条未知节点」而不是静默丢弃。
pub const UNKNOWN_NODE_ID: &str = "<unknown>";

/// 单条文档的解码结果。
///
/// 逐节点容错的最小单位。描述契约要求「一次请求内某节点参数不完整不阻断其他节点」,
/// 而 [`NodeDocument`] 的必填字段 (`schema` 非 Option、`points` / `layout` 必填) 使
/// **整体**反序列化成为全有全无的失败面: 画布上任意一条文档不合法即让整批描述失败,
/// 全部 widget 节点失去端口。把解码结果显式建模为「成功, 或该节点自己的失败」,
/// 使容错成为类型层面的事实, 而不是调用方需要记得遵守的约定。
#[derive(Debug, Clone)]
pub enum DecodedDocument {
    /// 文档结构合法, 可进入端口投影。
    Ready(Box<NodeDocument>),
    /// 文档结构不合法 —— 只为该节点产出 `Unsupported` 描述。
    Invalid {
        /// 请求文档声明的节点 id (缺失时为 [`UNKNOWN_NODE_ID`])。
        node_id: String,
        /// 结构失败的结构化问题 (含 serde 的位置信息)。
        issue: ModelIssue,
    },
}

/// 一次描述批 — 逐节点容错形态的请求。
#[derive(Debug, Clone)]
pub struct DescribeBatch {
    /// 请求侧版本号 (响应原样携带)。
    pub request_revision: u64,
    /// 逐条解码结果 (与请求顺序一致)。
    pub documents: Vec<DecodedDocument>,
    /// 相关边 (RawData `src:*` 动态端口推断用)。
    pub edges: Vec<GraphEdgeRef>,
}

impl DescribeBatch {
    /// 逐条解码请求文档 — 单条不合法只产出该条 [`DecodedDocument::Invalid`]。
    ///
    /// `documents` 为请求原样的 JSON 值, 每条独立 `from_value::<NodeDocument>`。
    /// 外层的整体结构不合法仍应由调用方在解码请求信封时拒绝 (那是协议错误,
    /// 不是节点配置错误); 本方法只兜住「信封合法、个别文档不合法」。
    #[must_use]
    pub fn decode(documents: &[Value], edges: Vec<GraphEdgeRef>, request_revision: u64) -> Self {
        let documents = documents
            .iter()
            .map(
                |document| match serde_json::from_value::<NodeDocument>(document.clone()) {
                    Ok(document) => DecodedDocument::Ready(Box::new(document)),
                    Err(error) => DecodedDocument::Invalid {
                        node_id: document
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or(UNKNOWN_NODE_ID)
                            .to_owned(),
                        issue: issue(
                            "document/invalid",
                            None,
                            error.to_string(),
                            data_model::model_descriptor::IssueSeverity::Error,
                        ),
                    },
                },
            )
            .collect();
        Self {
            request_revision,
            documents,
            edges,
        }
    }
}

/// 描述一批已解码文档。`request_revision` 原样回传。
///
/// 不合法文档不会中断整批 —— 这是与 [`describe_documents`] 的唯一差别, 也是
/// 线上路径必须走本函数的原因。
#[must_use]
pub fn describe_batch(batch: &DescribeBatch) -> DescribeResult {
    let nodes = batch
        .documents
        .iter()
        .map(|document| match document {
            DecodedDocument::Ready(document) => {
                describe_one(document, batch.request_revision, &batch.edges)
            }
            DecodedDocument::Invalid { node_id, issue } => NodeDescription {
                node_id: node_id.clone(),
                request_revision: batch.request_revision,
                status: NodeDescriptionStatus::Unsupported,
                inputs: Vec::new(),
                outputs: Vec::new(),
                default_input: None,
                default_output: None,
                effective_channels: None,
                hint: None,
                issues: vec![issue.clone()],
            },
        })
        .collect();
    DescribeResult {
        request_revision: batch.request_revision,
        nodes,
    }
}

/// 描述一批**已持有强类型文档**的请求。
///
/// 入参要求每条文档都已成功解码, 因此只适合进程内调用方; 线缆入口必须用
/// [`DescribeBatch::decode`] + [`describe_batch`], 否则退回全有全无的失败面。
pub fn describe_documents(request: &DescribeRequest) -> DescribeResult {
    let batch = DescribeBatch {
        request_revision: request.request_revision,
        documents: request
            .documents
            .iter()
            .cloned()
            .map(|document| DecodedDocument::Ready(Box::new(document)))
            .collect(),
        edges: request.edges.clone(),
    };
    describe_batch(&batch)
}

fn describe_one(
    document: &NodeDocument,
    request_revision: u64,
    edges: &[GraphEdgeRef],
) -> NodeDescription {
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
        kind::document::NodeBusiness::Protocol { schema, .. } => {
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
                let derived = derive_raw_data_ports(&document.id, edges);
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
#[path = "describe_tests.rs"]
mod tests;
