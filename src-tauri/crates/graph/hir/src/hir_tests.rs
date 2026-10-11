use super::*;
use graph_testkit::*;

#[test]
fn test_intern_and_roles() {
    // 同 id 双角色: ProtocolSource (value) + Protocol (byte) 共存
    let g = TypedGraph::build(
        vec![
            make_protocol_source("pt", "t1", "pt", 2),
            make_protocol("pt"),
            make_math("m1", "t1", kind::MathOp::Add, 1),
        ],
        vec![],
    )
    .unwrap();
    let ix = g.node_index("pt").unwrap();
    assert!(g.graph[ix].value_def.is_some());
    assert!(g.graph[ix].byte_def.is_some());
    // 单角色
    let m = g.node_index("m1").unwrap();
    assert!(g.graph[m].value_def.is_some());
    assert!(g.graph[m].byte_def.is_none());
    // value_nodes 只含数值平面定义
    assert_eq!(g.value_nodes().count(), 2);
}

#[test]
fn test_edge_classification() {
    let g = TypedGraph::build(
        vec![
            make_device("tp"),
            make_protocol("pt"),
            make_decoder("dec", "t1"),
            make_math("m1", "t1", kind::MathOp::Add, 1),
            make_str("s1", "t1", kind::StrOp::Upper),
            make_str("s2", "t1", kind::StrOp::Len),
        ],
        vec![
            edge("e-byte", "tp", "rx", "pt", "in"),
            edge("e-byte2", "pt", "out", "dec", "in"),
            edge("e-f32", "dec", "value", "m1", "in0"),
            edge("e-str", "s1", "result", "s2", "str"),
        ],
    )
    .unwrap();
    let class_of = |id: &str| {
        g.graph
            .edge_weights()
            .find(|e| e.id == id)
            .map(|e| e.class)
            .unwrap()
    };
    assert_eq!(class_of("e-byte"), EdgeClass::Byte);
    assert_eq!(class_of("e-byte2"), EdgeClass::Byte);
    assert_eq!(class_of("e-f32"), EdgeClass::F32);
    assert_eq!(class_of("e-str"), EdgeClass::Str);
}

#[test]
fn test_domain_mismatch() {
    // Protocol.out (Bytes) → Math.in0 (F32)
    let r = TypedGraph::build(
        vec![
            make_protocol("pt"),
            make_math("m1", "t1", kind::MathOp::Add, 1),
        ],
        vec![edge("e1", "pt", "out", "m1", "in0")],
    );
    assert!(matches!(r, Err(CompileError::DomainMismatch { .. })));
}

#[test]
fn test_raw_data_marker_classified_by_source_domain() {
    let g = TypedGraph::build(
        vec![
            make_device("tp"),
            make_protocol_source("pt", "t1", "pt", 1),
            make_protocol("pt"),
            make_sink("w-raw", "t1"),
        ],
        vec![
            edge("e-rx", "tp", "rx", "w-raw", "src:tp:rx"),
            edge("e-ch", "pt", "ch0", "w-raw", "src:pt:ch0"),
        ],
    )
    .unwrap();
    let class_of = |id: &str| {
        g.graph
            .edge_weights()
            .find(|e| e.id == id)
            .map(|e| e.class)
            .unwrap()
    };
    assert_eq!(
        class_of("e-rx"),
        EdgeClass::RawDataMarker(PortDomain::Bytes)
    );
    // 数值通道: (F32, F32) 同域, 先命中普通 F32 分类 (RawDataMarker 只承接跨域组合)
    assert_eq!(class_of("e-ch"), EdgeClass::F32);
    // 字节源标记边参与字节平面, 数值边参与值平面
    assert!(class_of("e-rx").in_byte_plane());
    assert!(!class_of("e-rx").in_value_plane());
    assert!(class_of("e-ch").in_value_plane());
    assert!(!class_of("e-ch").in_byte_plane());
}

#[test]
fn test_missing_endpoint_rejected() {
    let result = TypedGraph::build(
        vec![make_math("m1", "t1", kind::MathOp::Add, 1)],
        vec![edge("e1", "ghost", "result", "m1", "in0")],
    );
    assert!(matches!(result, Err(CompileError::NodeNotFound { id }) if id == "ghost"));
}

#[test]
fn acquisition_and_point_selector_use_declared_ports() {
    use data_model::device::{DevicePort, DevicePortDirection, DevicePortDomain};
    use data_model::device_tree::{DriverId, NodeDecl, NodeId};
    let device = kind::NodeDef::new(
        "device".into(),
        "t1".into(),
        NodeKind::Acquisition {
            node: NodeDecl {
                id: NodeId::new("device").unwrap(),
                name: "Device".into(),
                driver: DriverId("modbus-tcp".into()),
                schema_version: 1,
                config: serde_json::json!({}),
                enabled: true,
                capability_endpoint_id: Some("device".into()),
                children: Vec::new(),
            },
            ports: vec![DevicePort {
                id: "points".into(),
                direction: DevicePortDirection::Output,
                domain: DevicePortDomain::Points,
            }],
        },
    );
    let selector = kind::NodeDef::new(
        "selector".into(),
        "t1".into(),
        NodeKind::PointSelector {
            points: vec!["temperature".into()],
        },
    );
    let graph = TypedGraph::build(
        vec![device.clone(), selector.clone()],
        vec![edge("points", "device", "points", "selector", "points")],
    )
    .unwrap();
    assert_eq!(
        graph.graph.edge_weights().next().unwrap().class,
        EdgeClass::Points
    );

    let unknown_device_port = TypedGraph::build(
        vec![device, selector.clone()],
        vec![edge("bad", "device", "missing", "selector", "points")],
    );
    assert!(matches!(
        unknown_device_port,
        Err(CompileError::PortNotFound { .. })
    ));

    let unknown_point = TypedGraph::build(
        vec![selector, make_math("math", "t1", kind::MathOp::Add, 1)],
        vec![edge("bad-point", "selector", "missing", "math", "in0")],
    );
    assert!(matches!(
        unknown_point,
        Err(CompileError::PortNotFound { .. })
    ));
}

#[test]
fn test_raw_data_prefix_on_non_sink_rejected() {
    let r = TypedGraph::build(
        vec![
            make_protocol("pt"),
            make_math("m1", "t1", kind::MathOp::Add, 1),
        ],
        vec![edge("e1", "pt", "out", "m1", "src:pt:out")],
    );
    assert!(matches!(r, Err(CompileError::DomainMismatch { .. })));
}
