//! ProtocolSource NodeDef 自动注入 — 取代前端 `syncTabGraphToBackend` 内的手工注入
//!
//! 前端 `update_tab_graph` 只提交当前页签节点文档和边；
//! 后端编译时按"本 tab 内存在从 Protocol 节点输出端口出发的边"自动追加
//! 对应 ProtocolSource NodeDef, 供 `CompiledGraph::compile` 与 `evaluate` 消费。
//!
//! ProtocolSource 节点的 `id` = 被引用的 Protocol 节点 id,
//! `port_names` 与 `channels` 由 `protocol_source_port_names` / `ProtocolSchema::port_names`
//! 推导 (后端单一权威)。

use buffer_graph::Edge;
use pipeline::{NodeDef, NodeKind, protocol_source_port_names};
use schema_types::ProtocolConfig;
use std::collections::HashSet;

/// 给定原始节点表 + 边, 返回需要追加到编译列表的 ProtocolSource NodeDef
///
/// 输入边为前端提交的本 tab 边；ProtocolSource 仅在边**起点**为 Protocol 节点时追加。
pub fn inject_protocol_sources(nodes: &[NodeDef], edges: &[Edge]) -> Vec<NodeDef> {
    // 收集当前页签 Protocol 节点 (候选源)
    let protocols: Vec<&NodeDef> = nodes
        .iter()
        .filter(|n| matches!(n.kind, NodeKind::Protocol { .. }))
        .collect();
    if protocols.is_empty() {
        return Vec::new();
    }
    // 已注入去重: 同一全局 Protocol 节点只生成一份 ProtocolSource
    let mut emitted: HashSet<String> = HashSet::new();
    let mut sources: Vec<NodeDef> = Vec::new();
    for e in edges {
        // 边起点为全局 Protocol 节点 → 追加 ProtocolSource
        let proto = match protocols.iter().find(|p| p.id == e.source) {
            Some(p) => *p,
            None => continue,
        };
        if !emitted.insert(proto.id.clone()) {
            continue;
        }
        let (channels, port_names) = protocol_output_spec(proto, edges);
        // 双角色说明: 同一 id 的 Protocol 定义携带设备树来源 (byte_def 侧),
        // 这里注入的 ProtocolSource 只是它在数值平面的派生视图, 故标记 Derived。
        sources.push(NodeDef::derived(
            proto.id.clone(),
            proto.id.clone(),
            proto.tab_id.clone(),
            NodeKind::ProtocolSource {
                node_id: proto.id.clone(),
                channels,
                port_names,
            },
        ));
    }
    sources
}

/// 全局 Protocol 节点的输出端口 spec (channels + port_names)
///
/// - custom schema: 端口名 = `ProtocolSchema::port_names()`, 通道数 = 端口数
/// - preset: 端口名 = `protocol_source_port_names(None, channels)` (ch0..chN, RawData → 单 `str`)
fn protocol_output_spec(node: &NodeDef, edges: &[Edge]) -> (usize, Vec<String>) {
    let kind = &node.kind;
    let NodeKind::Protocol { config, schema, .. } = kind else {
        return (0, Vec::new());
    };
    match schema {
        s if s.preset == schema_types::SchemaPreset::Custom => {
            let names = s.port_names();
            (names.len(), names)
        }
        _ => {
            // preset (非 Custom) — 走 preset 路径
            if matches!(config, ProtocolConfig::RawData) {
                return (1, vec!["str".to_string()]);
            }
            let configured = channels_from_config(config);
            // 自动通道协议不能在编译期固定成默认 4 路。画布已经通过 source
            // handle 明确表达了实际引用的 chN，因此至少为最高被引用通道分配
            // 槽位；运行期仍由真实帧宽度决定是否产生样本/越界状态。
            let referenced = edges
                .iter()
                .filter(|edge| edge.source == node.id)
                .filter_map(|edge| edge.source_handle.strip_prefix("ch"))
                .filter_map(|index| index.parse::<usize>().ok())
                .max()
                .map_or(0, |index| index.saturating_add(1));
            let n = configured.max(referenced);
            let names = protocol_source_port_names(&[], n);
            (n, names)
        }
    }
}

fn channels_from_config(config: &ProtocolConfig) -> usize {
    match config {
        ProtocolConfig::JustFloat { channels } | ProtocolConfig::FireWater { channels } => {
            channels.unwrap_or(4)
        }
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use buffer_graph::Edge;
    use graph_testkit::make_device_in;
    use pipeline::NodeKind;
    use schema_types::{DecoderBlockDef, FieldType, SchemaPreset};

    fn protocol_node(
        id: &str,
        config: ProtocolConfig,
        schema: Option<schema_types::ProtocolSchema>,
    ) -> NodeDef {
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

    fn edge(source: &str, source_handle: &str, target: &str, target_handle: &str) -> Edge {
        Edge {
            id: format!("e-{source}-{target}"),
            source: source.into(),
            source_handle: source_handle.into(),
            target: target.into(),
            target_handle: target_handle.into(),
        }
    }

    #[test]
    fn empty_edges_yields_no_injection() {
        let n = protocol_node("p1", ProtocolConfig::JustFloat { channels: Some(4) }, None);
        assert!(inject_protocol_sources(&[n], &[]).is_empty());
    }

    #[test]
    fn edge_from_protocol_emits_single_protocol_source() {
        let proto = protocol_node("p1", ProtocolConfig::JustFloat { channels: Some(4) }, None);
        let widget = NodeDef::new("w1".into(), "tab1".into(), NodeKind::Sink);
        let edges = vec![edge("p1", "ch0", "w1", "in0")];
        let sources = inject_protocol_sources(&[proto, widget], &edges);
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].id, "p1");
        let NodeKind::ProtocolSource {
            node_id,
            channels,
            port_names,
        } = &sources[0].kind
        else {
            panic!("expected ProtocolSource");
        };
        assert_eq!(node_id, "p1");
        assert_eq!(*channels, 4);
        assert_eq!(
            port_names.as_slice(),
            &[
                "ch0".to_string(),
                "ch1".to_string(),
                "ch2".to_string(),
                "ch3".to_string()
            ]
        );
    }

    #[test]
    fn multiple_edges_to_same_protocol_emit_once() {
        let proto = protocol_node("p1", ProtocolConfig::JustFloat { channels: Some(2) }, None);
        let widget_a = NodeDef::new("wa".into(), "tab1".into(), NodeKind::Sink);
        let widget_b = NodeDef::new("wb".into(), "tab1".into(), NodeKind::Sink);
        let edges = vec![
            edge("p1", "ch0", "wa", "in0"),
            edge("p1", "ch1", "wb", "in0"),
        ];
        let sources = inject_protocol_sources(&[proto, widget_a, widget_b], &edges);
        assert_eq!(sources.len(), 1);
    }

    #[test]
    fn edge_from_device_does_not_emit_protocol_source() {
        let device = make_device_in("t1", "tab1");
        let widget = NodeDef::new("w1".into(), "tab1".into(), NodeKind::Sink);
        let edges = vec![edge("t1", "rx", "w1", "data")];
        let sources = inject_protocol_sources(&[device, widget], &edges);
        assert!(sources.is_empty());
    }

    #[test]
    fn custom_schema_emits_named_ports() {
        let schema = schema_types::ProtocolSchema {
            preset: SchemaPreset::Custom,
            preset_config: None,
            decode: vec![DecoderBlockDef::Field {
                id: "f1".into(),
                port_name: "rpm".into(),
                field_type: FieldType::Float32LE,
                length_ref: None,
                match_id: None,
            }],
            encode: None,
        };
        let proto = protocol_node(
            "p1",
            ProtocolConfig::JustFloat { channels: None },
            Some(schema),
        );
        let widget = NodeDef::new("w1".into(), "tab1".into(), NodeKind::Sink);
        let edges = vec![edge("p1", "rpm", "w1", "in0")];
        let sources = inject_protocol_sources(&[proto, widget], &edges);
        assert_eq!(sources.len(), 1);
        let NodeKind::ProtocolSource {
            channels,
            port_names,
            ..
        } = &sources[0].kind
        else {
            panic!();
        };
        assert_eq!(*channels, 1);
        assert_eq!(port_names.as_slice(), &["rpm".to_string()]);
    }

    #[test]
    fn rawdata_protocol_emits_str_only() {
        let proto = protocol_node("p1", ProtocolConfig::RawData, None);
        let widget = NodeDef::new("w1".into(), "tab1".into(), NodeKind::Sink);
        let edges = vec![edge("p1", "str", "w1", "in0")];
        let sources = inject_protocol_sources(&[proto, widget], &edges);
        assert_eq!(sources.len(), 1);
        let NodeKind::ProtocolSource {
            channels,
            port_names,
            ..
        } = &sources[0].kind
        else {
            panic!();
        };
        assert_eq!(*channels, 1);
        assert_eq!(port_names.as_slice(), &["str".to_string()]);
    }

    /// 与 derived 端 `preset_justfloat_auto_falls_back_to_default` 对齐:
    /// `channels: None` 时 inject 也回退到默认 4 端口, 避免两侧派生不一致
    #[test]
    fn preset_justfloat_auto_channels_uses_default_four() {
        let proto = protocol_node("p1", ProtocolConfig::JustFloat { channels: None }, None);
        let widget = NodeDef::new("w1".into(), "tab1".into(), NodeKind::Sink);
        let edges = vec![edge("p1", "ch0", "w1", "in0")];
        let sources = inject_protocol_sources(&[proto, widget], &edges);
        assert_eq!(sources.len(), 1);
        let NodeKind::ProtocolSource {
            channels,
            port_names,
            ..
        } = &sources[0].kind
        else {
            panic!("expected ProtocolSource");
        };
        assert_eq!(*channels, 4);
        assert_eq!(
            port_names.as_slice(),
            &[
                "ch0".to_string(),
                "ch1".to_string(),
                "ch2".to_string(),
                "ch3".to_string()
            ]
        );
    }

    #[test]
    fn preset_auto_channels_expand_to_highest_referenced_handle() {
        let proto = protocol_node("p1", ProtocolConfig::JustFloat { channels: None }, None);
        let widget = NodeDef::new("w1".into(), "tab1".into(), NodeKind::Sink);
        let edges = vec![edge("p1", "ch7", "w1", "value")];
        let sources = inject_protocol_sources(&[proto, widget], &edges);
        let NodeKind::ProtocolSource {
            channels,
            port_names,
            ..
        } = &sources[0].kind
        else {
            panic!("expected ProtocolSource");
        };
        assert_eq!(*channels, 8);
        assert_eq!(port_names.last().unwrap(), "ch7");
    }
}
