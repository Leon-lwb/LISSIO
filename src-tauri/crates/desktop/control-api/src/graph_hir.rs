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

use app::AppState;
use graph::{CompiledGraph, EdgeClass, HirNode, TypedGraph};
use kind::{NodeDef, NodeOrigin, PortDomain, port_domain};
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
    if let Some(bn) = &node.byte_def
        && matches!(
            port_domain(&bn.kind, handle, is_output),
            Some(PortDomain::Bytes)
        )
    {
        return PortDomain::Bytes;
    }
    // 事件端口不会出现在已编译图里 (hir 编译期即拒绝该边), 视图投影兜底 F32
    node.value_def
        .as_ref()
        .and_then(|n: &NodeDef| port_domain(&n.kind, handle, is_output))
        .unwrap_or(PortDomain::F32)
}

// ============ 测试 ============

#[cfg(test)]
#[path = "graph_hir_tests.rs"]
mod tests;
