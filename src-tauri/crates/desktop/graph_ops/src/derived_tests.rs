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
            op: kind::MathOp::Add,
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
