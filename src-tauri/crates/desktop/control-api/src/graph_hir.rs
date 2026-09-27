//! HIR 查询 — 把编译期 `TypedGraph` 投影为各出口可消费的序列化视图。
//!
//! 原实现是 Tauri 命令层 (`commands/graph/hir_query.rs`) 的私有逻辑; Web 出口
//! 需要同一条命令 (`get_graph_hir`), 因此把投影下沉到能力核心, 两个出口共用
//! 一份实现 (P3, 见 `docs/architecture/web-exit.md` §9.4)。
//!
//! 数据源是 [`AppState::graphs`] 里缓存的 `CompiledGraph.hir` (`TypedGraph`)。
//!
//! 与 [`crate::data`] 的关系:
//! - 本模块暴露"全图 HIR 视图" (节点 + 边 + 端口域 + 边分类), 走 `get_graph_hir` 拉取
//! - 显示订阅走 `graph:derived` 事件流 (每节点对外端口 + 通道数), 两者各司其职

use app::{
    AppState, CompiledGraph, EdgeClass, HirNode, NodeDef, NodeOrigin, PortDomain, TypedGraph,
    port_domain,
};
use petgraph::visit::{EdgeRef, IntoEdgeReferences};
use serde::Serialize;

/// 端口域 wire 形态 — 与 `derived::DerivedPortDomain` 一致 (`PascalCase` 序列化)
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum PortDomainView {
    Points,
    F32,
    Bytes,
    String,
    Spectrum,
}

impl From<PortDomain> for PortDomainView {
    fn from(d: PortDomain) -> Self {
        match d {
            PortDomain::Points => Self::Points,
            PortDomain::F32 => Self::F32,
            PortDomain::Bytes => Self::Bytes,
            PortDomain::String => Self::String,
            PortDomain::Spectrum => Self::Spectrum,
        }
    }
}

/// 边分类 wire 形态 — mirror `app::hir::EdgeClass`
/// (`tag = "kind"` + `snake_case` 变体名, 与前端 `kind` 字段对齐)
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HirEdgeClassView {
    Points,
    Byte,
    F32,
    Str,
    Spectrum,
    RawDataMarker { source_domain: PortDomainView },
}

impl From<EdgeClass> for HirEdgeClassView {
    fn from(c: EdgeClass) -> Self {
        match c {
            EdgeClass::Points => Self::Points,
            EdgeClass::Byte => Self::Byte,
            EdgeClass::F32 => Self::F32,
            EdgeClass::Str => Self::Str,
            EdgeClass::Spectrum => Self::Spectrum,
            EdgeClass::RawDataMarker(d) => Self::RawDataMarker {
                source_domain: d.into(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HirEdgeView {
    pub edge_id: String,
    pub source_node: String,
    pub source_handle: String,
    pub source_domain: PortDomainView,
    pub target_node: String,
    pub target_handle: String,
    pub target_domain: PortDomainView,
    pub class: HirEdgeClassView,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HirNodeView {
    pub node_id: String,
    pub has_value_def: bool,
    pub has_byte_def: bool,
    /// 节点来源标记 — 设备树派生 / 画布手写 / 由其它节点派生。
    ///
    /// 双角色节点以字节定义为权威（设备树语义优先, 见 `CompiledGraph::origin_of`）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<NodeOrigin>,
}

/// 「设备树节点 → 其派生子图」分组 — 编译结果即设备树派生的数据流图。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSubgraphView {
    /// 设备树投影起点 id（与图节点 id 同值）。
    pub device_node_id: String,
    /// 该树派生的全部图节点 id（升序, 含起点自身）。
    pub graph_nodes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphHir {
    pub tab_id: String,
    pub nodes: Vec<HirNodeView>,
    pub edges: Vec<HirEdgeView>,
    /// 设备树起点 → 派生子图（按起点 id 升序; 无设备树派生时为空）。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub device_subgraphs: Vec<DeviceSubgraphView>,
}

/// 按 tab 拉取 HIR 视图 (供 `compile-results` Tab 渲染)。
///
/// 注: `state.graphs` 仅在 `apply_tab_graph` 编译成功时插入 — 编译未完成
/// 或编译失败时返回空表 (前端会保留上次成功的 HIR 显示并展示占位文案)。
///
/// 锁持续时间与原命令实现保持一致: 仅 `state.graphs` HashMap lookup 与投影
/// 期间持锁, 迭代完成后立即释放。
pub fn graph_hir(state: &AppState, tab_id: &str) -> GraphHir {
    let graphs = state.graphs.lock();
    let view = extract_hir(tab_id, graphs.get(tab_id));
    drop(graphs);
    view
}

/// 从 `CompiledGraph` 提取 HIR 视图; 编译未完成 (无 CompiledGraph) 返回空表
pub fn extract_hir(tab_id: &str, graph: Option<&CompiledGraph>) -> GraphHir {
    let Some(g) = graph else {
        return GraphHir {
            tab_id: tab_id.to_string(),
            nodes: Vec::new(),
            edges: Vec::new(),
            device_subgraphs: Vec::new(),
        };
    };
    let typed: &TypedGraph = g.hir();
    let nodes: Vec<HirNodeView> = typed
        .graph
        .node_indices()
        .map(|ix| {
            let w = &typed.graph[ix];
            HirNodeView {
                node_id: w.id.clone(),
                has_value_def: w.value_def.is_some(),
                has_byte_def: w.byte_def.is_some(),
                origin: g.origin_of(&w.id).cloned(),
            }
        })
        .collect();
    let edges: Vec<HirEdgeView> = typed
        .graph
        .edge_references()
        .map(|er| {
            let src_ix = er.source();
            let tgt_ix = er.target();
            let weight = er.weight();
            let src_node_id = typed.id_of(src_ix).to_string();
            let tgt_node_id = typed.id_of(tgt_ix).to_string();
            let src_node_w = &typed.graph[src_ix];
            let tgt_node_w = &typed.graph[tgt_ix];
            let src_domain = port_domain_of_node(src_node_w, &weight.source_handle, true);
            let tgt_domain = port_domain_of_node(tgt_node_w, &weight.target_handle, false);
            HirEdgeView {
                edge_id: weight.id.clone(),
                source_node: src_node_id,
                source_handle: weight.source_handle.clone(),
                source_domain: src_domain.into(),
                target_node: tgt_node_id,
                target_handle: weight.target_handle.clone(),
                target_domain: tgt_domain.into(),
                class: weight.class.into(),
            }
        })
        .collect();
    GraphHir {
        tab_id: tab_id.to_string(),
        nodes,
        edges,
        device_subgraphs: g
            .device_subgraphs()
            .map(|(device_node_id, graph_nodes)| DeviceSubgraphView {
                device_node_id: device_node_id.to_string(),
                graph_nodes: graph_nodes.to_vec(),
            })
            .collect(),
    }
}

/// 端口域解析 (mirror `app::hir::domain_of`):
/// 优先查 byte_def (handle 命名两平面正交, 字节判定优先); 否则回落 value_def;
/// 占位节点 (无双角色定义) 按 F32 处理.
///
/// 与 `app::hir::domain_of` 行为一致; 该函数暂未 pub,
/// 此处独立维护一份以避免反向修改 engine 公共 API (行为逐字保持, 未随下沉改动).
fn port_domain_of_node(node: &HirNode, handle: &str, is_output: bool) -> PortDomain {
    if let Some(bn) = &node.byte_def {
        let d = port_domain(&bn.kind, handle, is_output);
        if d == PortDomain::Bytes {
            return d;
        }
    }
    node.value_def
        .as_ref()
        .map_or(PortDomain::F32, |n: &NodeDef| {
            port_domain(&n.kind, handle, is_output)
        })
}

// ============ 测试 ============

#[cfg(test)]
mod tests {
    use super::*;
    use app::{NodeDef, NodeKind};

    fn math_def(id: &str, tab_id: &str) -> NodeDef {
        NodeDef::new(
            id.into(),
            tab_id.into(),
            NodeKind::Math {
                op: app::MathOp::Add,
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
                app::NodeKind::ProtocolSource {
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
}
