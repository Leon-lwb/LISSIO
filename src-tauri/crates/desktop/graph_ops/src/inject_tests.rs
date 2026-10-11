use super::*;
use buffer_graph::Edge;
use graph_testkit::make_device_in;
use kind::NodeKind;
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
