use super::*;
use kind::{NodeDef, NodeKind};

fn math_def(id: &str, tab_id: &str) -> NodeDef {
    NodeDef::new(
        id.into(),
        tab_id.into(),
        NodeKind::Math {
            op: kind::MathOp::Add,
            input_count: 1,
        },
    )
}

fn device_def(id: &str) -> NodeDef {
    graph_testkit::make_device_in(id, "main")
}

fn protocol_def(id: &str) -> NodeDef {
    NodeDef::new(
        id.into(),
        "main".into(),
        NodeKind::Protocol {
            schema: schema_types::schema_from_protocol_config(
                &schema_types::ProtocolConfig::JustFloat { channels: None },
            ),
            config: schema_types::ProtocolConfig::JustFloat { channels: None },
            convert_to: None,
        },
    )
}

fn input_def(id: &str, tab_id: &str) -> NodeDef {
    NodeDef::new(id.into(), tab_id.into(), NodeKind::Input)
}

/// 编译成功 → HIR 含全部节点 + 边
#[test]
fn extract_hir_returns_classified_edges() {
    let nodes = vec![input_def("in1", "t1"), math_def("m1", "t1")];
    let edges = vec![buffer_graph::Edge {
        id: "e1".into(),
        source: "in1".into(),
        source_handle: "value".into(),
        target: "m1".into(),
        target_handle: "in0".into(),
    }];
    let compiled = CompiledGraph::compile("t1".into(), nodes, edges).unwrap();
    let view = extract_hir("t1", Some(&compiled));
    assert_eq!(view.tab_id, "t1");
    assert_eq!(view.nodes.len(), 2);
    assert_eq!(view.edges.len(), 1, "编译时含 1 条边, HIR 视图应保留");
    assert_eq!(view.edges[0].edge_id, "e1");
    assert_eq!(view.edges[0].class, HirEdgeClassView::F32);
}

/// 编译未完成 (无 CompiledGraph) → 返回空表
#[test]
fn extract_hir_returns_empty_when_no_graph() {
    let view = extract_hir("t1", None);
    assert_eq!(view.tab_id, "t1");
    assert!(view.nodes.is_empty());
    assert!(view.edges.is_empty());
}

/// 字节边分类: Transport.out → Protocol.in (两端 Bytes 域)
#[test]
fn extract_hir_byte_edge_class() {
    let nodes = vec![device_def("tp"), protocol_def("pt")];
    let edges = vec![buffer_graph::Edge {
        id: "e-byte".into(),
        source: "tp".into(),
        source_handle: "rx".into(),
        target: "pt".into(),
        target_handle: "in".into(),
    }];
    let compiled = CompiledGraph::compile("main".into(), nodes, edges).unwrap();
    let view = extract_hir("main", Some(&compiled));
    let edge = view.edges.iter().find(|e| e.edge_id == "e-byte").unwrap();
    assert_eq!(edge.class, HirEdgeClassView::Byte);
    assert_eq!(edge.source_domain, PortDomainView::Bytes);
    assert_eq!(edge.target_domain, PortDomainView::Bytes);
}

/// 双角色节点: ProtocolSource (value) + Protocol (byte) 同 id 共存
#[test]
fn extract_hir_dual_role_node() {
    let nodes = vec![
        NodeDef::new(
            "pt".into(),
            "t1".into(),
            kind::NodeKind::ProtocolSource {
                node_id: "pt".into(),
                channels: 1,
                port_names: Vec::new(),
            },
        ),
        protocol_def("pt"),
    ];
    let compiled = CompiledGraph::compile("t1".into(), nodes, vec![]).unwrap();
    let view = extract_hir("t1", Some(&compiled));
    let pt_node = view.nodes.iter().find(|n| n.node_id == "pt").unwrap();
    assert!(pt_node.has_value_def, "ProtocolSource 是数值平面定义");
    assert!(pt_node.has_byte_def, "Protocol 是字节平面定义");
}

/// 编译结果即设备树派生的数据流图: HIR 视图暴露来源标记与派生子图分组。
#[test]
fn extract_hir_exposes_device_tree_provenance() {
    use data_model::device_tree::{NodeId, NodePath, NodeRole};

    let mut device = device_def("source");
    device.origin = NodeOrigin::DeviceTree {
        node_id: NodeId::new("source").unwrap(),
        path: NodePath::root("source").unwrap(),
        role: None,
        root: NodeId::new("source").unwrap(),
        parent: None,
    };
    let mut protocol = protocol_def("pt");
    protocol.origin = NodeOrigin::DeviceTree {
        node_id: NodeId::new("pt").unwrap(),
        path: NodePath::root("source").unwrap().child("pt").unwrap(),
        role: Some(NodeRole::Protocol),
        root: NodeId::new("source").unwrap(),
        parent: Some(NodeId::new("source").unwrap()),
    };
    let mut canvas = math_def("m1", "main");
    canvas.origin = NodeOrigin::Derived {
        from: "pt".to_string(),
    };

    let compiled = CompiledGraph::compile(
        "main".into(),
        vec![device, protocol, canvas],
        vec![buffer_graph::Edge {
            id: "e-byte".into(),
            source: "source".into(),
            source_handle: "rx".into(),
            target: "pt".into(),
            target_handle: "in".into(),
        }],
    )
    .unwrap();
    let view = extract_hir("main", Some(&compiled));

    let pt = view.nodes.iter().find(|n| n.node_id == "pt").unwrap();
    assert_eq!(
        pt.origin
            .as_ref()
            .and_then(NodeOrigin::root_device_node)
            .map(NodeId::as_str),
        Some("source")
    );
    let m1 = view.nodes.iter().find(|n| n.node_id == "m1").unwrap();
    assert!(
        matches!(m1.origin, Some(NodeOrigin::Derived { .. })),
        "派生节点的设备树归属由分组索引回答, 节点标记只记录派生来源"
    );
    assert_eq!(view.device_subgraphs.len(), 1);
    assert_eq!(view.device_subgraphs[0].device_node_id, "source");
    assert_eq!(
        view.device_subgraphs[0].graph_nodes,
        ["m1", "pt", "source"],
        "派生子图含起点自身及其派生节点 (升序)"
    );
}
