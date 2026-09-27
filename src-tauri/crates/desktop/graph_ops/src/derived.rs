//! 图编译派生数据 — 节点输出端口表与生效通道数 (后端单一权威)
//!
//! 由 [`compute_derived`] 在 `apply_tab_graph` 编译成功后计算,
//! 随 `update_tab_graph` Tauri 命令返回并经 `graph:derived` 事件差分推送。
//! 前端 `derivedPorts` store 据此渲染 React Flow handle 与节点摘要。

use pipeline::{NodeDef, NodeKind, PortDomain, port_table};
use schema_types::{ProtocolConfig, ProtocolSchema};
use serde::Serialize;

/// 单个输出端口的派生元数据 (与前端 `NodeDerived.ports[]` 对应)
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NodeDerivedPort {
    /// 端口 id (handle 字符串)
    pub name: String,
    /// 端口承载域 (F32 / Bytes / String)
    pub domain: PortDomain,
}

/// 单节点派生数据
///
/// - `ports` 仅含**输出**端口;输入端口由消费方 (下游节点) 从自身 ports 表查
/// - `effective_channels` 仅 Protocol 节点有意义 (None = 其他节点)
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NodeDerived {
    pub node_id: String,
    pub ports: Vec<NodeDerivedPort>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_channels: Option<usize>,
}

/// 图级派生数据 — 多个节点的批 (随命令响应 / 事件推送)
///
/// `version` 为提交成功后的全局图版本号 (前端以此作为下次提交的 base_version,
/// 用于多写入方冲突检测)
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GraphDerived {
    pub nodes: Vec<NodeDerived>,
    pub version: u64,
}

/// 给定一组节点定义, 派生每个节点的输出端口表与生效通道数
///
/// - 全局 Protocol 节点:端口表由 `ProtocolSchema::port_names()` (custom) 或
///   `protocol_source_port_names(channels)` (preset, RawData → 单 `str` 字符串域) 决定;
///   `effective_channels` = 手动配置值或回退默认
/// - widget 节点 (Input/Math/Str/Custom/Filter/Fft/Ifft/FrameDecoder/Trigger/
///   TextInput/Sink/TextDisplay/TextOut/ProtocolSource): 由 [`kind_output_ports`]
///   按 [`pipeline::port_table`] 枚举 (固定端口种类), 动态端口种类返回空
pub fn compute_derived(nodes: &[NodeDef]) -> Vec<NodeDerived> {
    nodes.iter().map(derive_node).collect()
}

fn derive_node(n: &NodeDef) -> NodeDerived {
    match &n.kind {
        NodeKind::Acquisition { ports, .. } => NodeDerived {
            node_id: n.id.clone(),
            ports: ports
                .iter()
                .filter(|port| {
                    port.direction != data_model::device::DevicePortDirection::Input
                        && port.domain != data_model::device::DevicePortDomain::Events
                })
                .map(|port| NodeDerivedPort {
                    name: port.id.clone(),
                    domain: match port.domain {
                        data_model::device::DevicePortDomain::Bytes => PortDomain::Bytes,
                        data_model::device::DevicePortDomain::Points => PortDomain::Points,
                        data_model::device::DevicePortDomain::Numeric => PortDomain::F32,
                        data_model::device::DevicePortDomain::Events => unreachable!(),
                    },
                })
                .collect(),
            effective_channels: None,
        },
        NodeKind::PointSelector { points } => NodeDerived {
            node_id: n.id.clone(),
            ports: points
                .iter()
                .map(|name| NodeDerivedPort {
                    name: name.clone(),
                    domain: PortDomain::F32,
                })
                .collect(),
            effective_channels: Some(points.len()),
        },
        NodeKind::Protocol { config, schema, .. } => derive_protocol(n.id.clone(), config, schema),
        NodeKind::ProtocolSource { .. } => NodeDerived {
            // 端口表与所引用的当前页签 Protocol 节点同源 — 渲染端按节点 id 读,
            // 此处重复一份便于初次派生到达前的占位查询
            node_id: n.id.clone(),
            ports: Vec::new(),
            effective_channels: None,
        },
        NodeKind::Sink => NodeDerived {
            // Sink 视 widget 类型有不同 ports (Waveform ch0..N, PieChart seg0..N, ...);
            // 当前 widget 配置不在 NodeDef 中, 由前端 widgetToNodeKind 已隐式处理 —
            // 此处返回空, 前端继续走本地 widgetPorts() (widget spec 派生, 非图编译推导)
            node_id: n.id.clone(),
            ports: Vec::new(),
            effective_channels: None,
        },
        _ => NodeDerived {
            node_id: n.id.clone(),
            ports: kind_output_ports(&n.kind),
            effective_channels: None,
        },
    }
}

fn derive_protocol(
    node_id: String,
    config: &ProtocolConfig,
    schema: &ProtocolSchema,
) -> NodeDerived {
    // Custom: 端口由 decode 块派生, 通道数 = 端口数; preset: 端口按 config 工厂构造
    let (ports, channels) = if schema.preset == schema_types::SchemaPreset::Custom {
        let names = schema.port_names();
        let ports = names
            .iter()
            .map(|p| NodeDerivedPort {
                name: p.clone(),
                domain: domain_for_protocol_port(p),
            })
            .collect();
        (ports, names.len())
    } else {
        let names = preset_port_names(config);
        let ports = names
            .iter()
            .map(|p| NodeDerivedPort {
                name: p.clone(),
                domain: domain_for_protocol_port(p),
            })
            .collect();
        let n = names.len();
        (ports, n)
    };
    NodeDerived {
        node_id,
        ports,
        effective_channels: Some(channels),
    }
}

/// preset 协议端口表 — 委托 schema_types 的单一权威工厂
/// (RawData → 单 "str" 字符串域; 其余预设 ch0..chN)
fn preset_port_names(config: &ProtocolConfig) -> Vec<String> {
    schema_types::protocol_port_names(None, config, 0)
}

/// Protocol 节点端口域: ch0..chN 数值域 (F32); "str" (RawData 原始字节文本) 字符串域
fn domain_for_protocol_port(name: &str) -> PortDomain {
    if name == "str" {
        PortDomain::String
    } else {
        PortDomain::F32
    }
}

/// 按 NodeKind 枚举其标准输出端口 — 直接派生自 [`pipeline::port_table`]
/// (端口域单一事实源, 不再手工镜像 `port_domain`)
///
/// - Custom: 用户代码定义端口 (NodeDef 携带), 全 F32
/// - FrameDecoder/Filter: 输出端口由 blocks / 前端 widget spec 决定, 不在此枚举
/// - 其余固定端口种类由端口表输出子表给出 (TextOut/TextDisplay 自然为空)
fn kind_output_ports(kind: &NodeKind) -> Vec<NodeDerivedPort> {
    match kind {
        NodeKind::Custom { outputs, .. } => outputs
            .iter()
            .map(|n| port(n.as_str(), PortDomain::F32))
            .collect(),
        NodeKind::FrameDecoder { .. } | NodeKind::Filter { .. } => Vec::new(),
        _ => port_table(kind)
            .outputs
            .iter()
            .map(|p| port(p.handle, p.domain))
            .collect(),
    }
}

fn port(name: &str, domain: PortDomain) -> NodeDerivedPort {
    NodeDerivedPort {
        name: name.to_string(),
        domain,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use data_model::device::{DevicePort, DevicePortDirection, DevicePortDomain};
    use data_model::device_tree::{DriverId, NodeDecl, NodeId};
    use schema_types::{DecoderBlockDef, FieldType, SchemaPreset};
    use serde_json::json;

    fn protocol_node(id: &str, config: ProtocolConfig, schema: Option<ProtocolSchema>) -> NodeDef {
        // 未显式给 schema 的用例按 config 构造预设 schema
        let schema = schema.unwrap_or_else(|| schema_types::schema_from_protocol_config(&config));
        NodeDef::new(
            id.into(),
            "tab1".into(),
            NodeKind::Protocol {
                schema,
                config,
                convert_to: None,
            },
        )
    }

    #[test]
    fn custom_schema_derives_named_ports() {
        let schema = ProtocolSchema {
            preset: SchemaPreset::Custom,
            preset_config: None,
            decode: vec![
                DecoderBlockDef::Field {
                    id: "f1".into(),
                    port_name: "voltage".into(),
                    field_type: FieldType::Float32LE,
                    length_ref: None,
                    match_id: None,
                },
                DecoderBlockDef::Field {
                    id: "f2".into(),
                    port_name: "current".into(),
                    field_type: FieldType::Float32LE,
                    length_ref: None,
                    match_id: None,
                },
            ],
            encode: None,
        };
        let n = protocol_node(
            "p1",
            ProtocolConfig::JustFloat { channels: None },
            Some(schema),
        );
        let derived = compute_derived(&[n]);
        assert_eq!(derived.len(), 1);
        assert_eq!(
            derived[0].ports,
            vec![
                NodeDerivedPort {
                    name: "voltage".into(),
                    domain: PortDomain::F32
                },
                NodeDerivedPort {
                    name: "current".into(),
                    domain: PortDomain::F32
                },
            ]
        );
        assert_eq!(derived[0].effective_channels, Some(2));
    }

    #[test]
    fn preset_justfloat_with_manual_channels_uses_config_value() {
        let n = protocol_node("p1", ProtocolConfig::JustFloat { channels: Some(6) }, None);
        let derived = compute_derived(&[n]);
        let names: Vec<_> = derived[0]
            .ports
            .iter()
            .map(|p| (p.name.as_str(), p.domain))
            .collect();
        assert_eq!(
            names,
            vec![
                ("ch0", PortDomain::F32),
                ("ch1", PortDomain::F32),
                ("ch2", PortDomain::F32),
                ("ch3", PortDomain::F32),
                ("ch4", PortDomain::F32),
                ("ch5", PortDomain::F32),
            ]
        );
        assert_eq!(derived[0].effective_channels, Some(6));
    }

    #[test]
    fn preset_justfloat_auto_falls_back_to_default() {
        let n = protocol_node("p1", ProtocolConfig::JustFloat { channels: None }, None);
        let derived = compute_derived(&[n]);
        assert_eq!(derived[0].ports.len(), 4);
        assert_eq!(derived[0].effective_channels, Some(4));
    }

    #[test]
    fn rawdata_protocol_uses_str_string_domain_only() {
        let n = protocol_node("p1", ProtocolConfig::RawData, None);
        let derived = compute_derived(&[n]);
        assert_eq!(derived[0].ports.len(), 1);
        assert_eq!(derived[0].ports[0].name, "str");
        assert_eq!(derived[0].ports[0].domain, PortDomain::String);
        assert_eq!(derived[0].effective_channels, Some(1));
    }

    #[test]
    fn non_protocol_kinds_produce_known_ports() {
        let input = NodeDef::new("i1".into(), "tab1".into(), NodeKind::Input);
        let math = NodeDef::new(
            "m1".into(),
            "tab1".into(),
            NodeKind::Math {
                op: pipeline::MathOp::Add,
                input_count: 3,
            },
        );
        let text_in = NodeDef::new(
            "t1".into(),
            "tab1".into(),
            NodeKind::TextInput { text: "hi".into() },
        );
        let derived = compute_derived(&[input, math, text_in]);
        assert_eq!(derived[0].ports, vec![port("value", PortDomain::F32)]);
        assert_eq!(derived[1].ports, vec![port("result", PortDomain::F32)]);
        assert_eq!(derived[2].ports, vec![port("str", PortDomain::String)]);
    }

    #[test]
    fn acquisition_outputs_are_derived_from_capability_ports() {
        let node = NodeDef::new(
            "device-1".into(),
            "tab1".into(),
            NodeKind::Acquisition {
                node: NodeDecl {
                    id: NodeId::new("device-1").unwrap(),
                    name: "serial".into(),
                    driver: DriverId("serial".into()),
                    schema_version: 1,
                    config: json!({}),
                    enabled: true,
                    capability_endpoint_id: None,
                    children: Vec::new(),
                },
                ports: vec![
                    DevicePort {
                        id: "tx".into(),
                        direction: DevicePortDirection::Input,
                        domain: DevicePortDomain::Bytes,
                    },
                    DevicePort {
                        id: "rx".into(),
                        direction: DevicePortDirection::Output,
                        domain: DevicePortDomain::Bytes,
                    },
                    DevicePort {
                        id: "points".into(),
                        direction: DevicePortDirection::Bidirectional,
                        domain: DevicePortDomain::Points,
                    },
                    DevicePort {
                        id: "events".into(),
                        direction: DevicePortDirection::Output,
                        domain: DevicePortDomain::Events,
                    },
                ],
            },
        );

        let derived = compute_derived(&[node]);
        assert_eq!(
            derived[0].ports,
            vec![
                port("rx", PortDomain::Bytes),
                port("points", PortDomain::Points),
            ]
        );
    }
}
