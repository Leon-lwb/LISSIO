use super::*;
use data_model::device::{DevicePort, DevicePortDirection, DevicePortDomain};
use data_model::device_tree::{DriverId, NodeDecl, NodeId};
use serde_json::json;

use crate::kind::NodeKind;
use crate::math_op::MathOp;
use crate::str_op::{StrNumParams, StrOp};

fn device() -> NodeKind {
    NodeKind::Acquisition {
        node: NodeDecl {
            id: NodeId::new("device").unwrap(),
            name: "device".into(),
            driver: DriverId("serial".into()),
            schema_version: 1,
            config: json!({}),
            enabled: true,
            capability_endpoint_id: None,
            children: Vec::new(),
        },
        ports: vec![
            DevicePort {
                id: "rx".into(),
                direction: DevicePortDirection::Output,
                domain: DevicePortDomain::Bytes,
            },
            DevicePort {
                id: "tx".into(),
                direction: DevicePortDirection::Input,
                domain: DevicePortDomain::Bytes,
            },
        ],
    }
}

fn protocol_default() -> NodeKind {
    let config = schema_types::ProtocolConfig::default();
    NodeKind::Protocol {
        schema: schema_types::schema_from_protocol_config(&config),
        config,
        convert_to: None,
    }
}

fn decoder() -> NodeKind {
    NodeKind::FrameDecoder {
        blocks: vec![],
        enable_valid: false,
        enable_frame_count: false,
        enable_last_timestamp: false,
        enable_fps: false,
    }
}

fn sink() -> NodeKind {
    NodeKind::Sink
}

fn source() -> NodeKind {
    NodeKind::ProtocolSource {
        node_id: "p1".into(),
        channels: 2,
        port_names: Vec::new(),
    }
}

fn math() -> NodeKind {
    NodeKind::Math {
        op: MathOp::Add,
        input_count: 2,
    }
}

fn str_op(op: StrOp) -> NodeKind {
    NodeKind::Str {
        op,
        num: StrNumParams::default(),
        tmpl: String::new(),
    }
}

fn text_input() -> NodeKind {
    NodeKind::TextInput {
        text: "hello".to_string(),
    }
}

#[test]
fn device_handles() {
    let k = device();
    assert_eq!(
        port_domain(&k, TRANSPORT_RX_HANDLE, true),
        Some(PortDomain::Bytes)
    );
    assert_eq!(
        port_domain(&k, TRANSPORT_TX_HANDLE, false),
        Some(PortDomain::Bytes)
    );
}

#[test]
fn protocol_handles() {
    let k = protocol_default();
    assert_eq!(
        port_domain(&k, PROTOCOL_IN_HANDLE, false),
        Some(PortDomain::Bytes)
    );
    assert_eq!(
        port_domain(&k, PROTOCOL_OUT_HANDLE, true),
        Some(PortDomain::Bytes)
    );
}

#[test]
fn decoder_handles() {
    let k = decoder();
    assert_eq!(
        port_domain(&k, FRAME_DECODER_IN_HANDLE, false),
        Some(PortDomain::Bytes)
    );
    assert_eq!(port_domain(&k, "value", true), Some(PortDomain::F32));
}

#[test]
fn sink_and_command_loopback_out() {
    let k = sink();
    assert_eq!(
        port_domain(&k, LOOPBACK_OUT_HANDLE, true),
        Some(PortDomain::Bytes)
    );
    assert_eq!(port_domain(&k, "value", false), Some(PortDomain::F32));
}

#[test]
fn sink_spectrum_input_is_spectrum_domain() {
    // Spectrum 控件 (编译为 Sink) 经 "spectrum" 口消费频谱平面
    let k = sink();
    assert_eq!(
        port_domain(&k, "spectrum", false),
        Some(PortDomain::Spectrum)
    );
    assert_eq!(port_domain(&k, "spectrum", true), Some(PortDomain::F32));
}

#[test]
fn protocol_source_str_handle_is_string_domain() {
    let k = source();
    assert_eq!(port_domain(&k, "ch0", true), Some(PortDomain::F32));
    assert_eq!(port_domain(&k, "str", true), Some(PortDomain::String));
    assert_eq!(port_domain(&k, "str", false), Some(PortDomain::F32));
}

#[test]
fn math_input_output_is_f32() {
    let k = math();
    assert_eq!(port_domain(&k, "in0", false), Some(PortDomain::F32));
    assert_eq!(port_domain(&k, "result", true), Some(PortDomain::F32));
}

#[test]
fn str_op_port_table_is_source_of_truth() {
    let len = str_op(StrOp::Len);
    assert_eq!(port_domain(&len, "str", false), Some(PortDomain::String));
    assert_eq!(port_domain(&len, "result", true), Some(PortDomain::F32));

    let mid = str_op(StrOp::Mid);
    assert_eq!(port_domain(&mid, "str", false), Some(PortDomain::String));
    assert_eq!(port_domain(&mid, "pos", false), Some(PortDomain::F32));
    assert_eq!(port_domain(&mid, "len", false), Some(PortDomain::F32));
    assert_eq!(port_domain(&mid, "result", true), Some(PortDomain::String));

    let replace = str_op(StrOp::Replace);
    assert_eq!(
        port_domain(&replace, "str1", false),
        Some(PortDomain::String)
    );
    assert_eq!(
        port_domain(&replace, "str2", false),
        Some(PortDomain::String)
    );
    assert_eq!(port_domain(&replace, "pos", false), Some(PortDomain::F32));
    assert_eq!(
        port_domain(&replace, "result", true),
        Some(PortDomain::String)
    );
}

#[test]
fn text_input_str_handle_is_string_output_only() {
    let k = text_input();
    assert_eq!(port_domain(&k, "str", true), Some(PortDomain::String));
    assert_eq!(port_domain(&k, "str", false), Some(PortDomain::F32));
    assert_eq!(port_domain(&k, "value", true), Some(PortDomain::F32));
}

#[test]
fn text_display_text_input_is_string_domain() {
    // 回归: TextDisplay 的 "text" 输入口属字符串平面 —
    // TextInput.str / Trigger.text / ProtocolSource.str 可连
    let k = NodeKind::TextDisplay;
    assert_eq!(port_domain(&k, "text", false), Some(PortDomain::String));
    assert_eq!(port_domain(&k, "text", true), Some(PortDomain::F32));
    assert_eq!(port_domain(&k, "value", false), Some(PortDomain::F32));
}

#[test]
fn port_tables_expose_typed_specs() {
    // 端口表即单一事实源 — 抽查静态表形状与 port_domain 一致
    let trigger = NodeKind::Trigger {
        mode: "manual".into(),
        edge: "level".into(),
        default_miss: 0.0,
        default_miss_text: String::new(),
        command: String::new(),
        rules: vec![],
    };
    assert_eq!(
        port_table(&trigger).outputs,
        &[
            PortSpec::new("value", PortDomain::F32),
            PortSpec::new("matched", PortDomain::F32),
            PortSpec::new("text", PortDomain::String),
        ]
    );
    assert_eq!(
        port_table(&NodeKind::TextDisplay).inputs,
        &[PortSpec::new("text", PortDomain::String)]
    );
    assert_eq!(port_table(&NodeKind::TextDisplay).outputs, &[],);
    assert_eq!(
        port_table(&NodeKind::Str {
            op: StrOp::Mid,
            num: StrNumParams::default(),
            tmpl: String::new(),
        })
        .inputs,
        &[
            PortSpec::new("str", PortDomain::String),
            PortSpec::new("pos", PortDomain::F32),
            PortSpec::new("len", PortDomain::F32),
        ]
    );
}
