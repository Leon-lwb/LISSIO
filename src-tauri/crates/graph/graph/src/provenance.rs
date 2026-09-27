//! 编译产物 provenance 索引 — 图节点与设备树节点的双向归属查询。
//!
//! 索引在编译期一次性构建（遍历 HIR 的 O(V+E)），只承载只读元数据：
//! 逐帧热路径（`CompiledGraph::evaluate` / `CompiledEval::run`）完全不引用它。
//!
//! 语义约定：
//! - 双角色节点（同一 id 同时是全局 `Protocol`/`Acquisition` 字节定义与本 tab 的
//!   数值平面视图）以**字节定义**为来源权威，即设备树语义优先；
//! - 由设备树派生节点继续派生的节点（如注入的 `ProtocolSource`）沿
//!   [`NodeOrigin::Derived`] 链回溯到同一设备树投影起点。

use std::collections::{BTreeMap, BTreeSet};

use hir::TypedGraph;
use kind::NodeOrigin;

/// 编译期 provenance 索引（图节点 → 来源，以及与设备树节点的双向归属）。
///
/// `pub` 在私有模块内即 crate 可见（`mod provenance` 不对外导出）。
#[derive(Debug)]
pub struct Provenance {
    /// 图节点 id → 来源标记（升序，保证查询与遍历确定性）。
    origins: BTreeMap<String, NodeOrigin>,
    /// 图节点 id → 其设备树投影起点 id（仅设备树派生节点存在）。
    device_roots: BTreeMap<String, String>,
    /// 设备树投影起点 id → 该树派生的全部图节点 id（升序）。
    device_subgraphs: BTreeMap<String, Vec<String>>,
}

impl Provenance {
    /// 从编译前端产物构建索引。
    pub(crate) fn build(hir: &TypedGraph) -> Self {
        let mut origins = BTreeMap::new();
        for node in hir.graph.node_weights() {
            let origin = node
                .byte_def
                .as_ref()
                .or(node.value_def.as_ref())
                .map(|definition| definition.origin.clone());
            if let Some(origin) = origin {
                origins.insert(node.id.clone(), origin);
            }
        }
        let mut device_roots = BTreeMap::new();
        let mut device_subgraphs: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for (id, origin) in &origins {
            let Some(root) = resolve_device_root(&origins, origin) else {
                continue;
            };
            device_roots.insert(id.clone(), root.clone());
            // `origins` 为升序映射，故每个派生分组天然按 id 升序。
            device_subgraphs.entry(root).or_default().push(id.clone());
        }
        Self {
            origins,
            device_roots,
            device_subgraphs,
        }
    }

    /// 单节点来源。
    pub(crate) fn origin_of(&self, node_id: &str) -> Option<&NodeOrigin> {
        self.origins.get(node_id)
    }

    /// 全部来源标记（按节点 id 升序）。
    pub(crate) fn entries(&self) -> impl Iterator<Item = (&str, &NodeOrigin)> + '_ {
        self.origins
            .iter()
            .map(|(id, origin)| (id.as_str(), origin))
    }

    /// 按设备树节点取其派生子图（该节点所在树派生的全部图节点 id，升序）。
    pub(crate) fn derived_from_device_node(&self, device_node_id: &str) -> &[String] {
        self.device_subgraphs
            .get(device_node_id)
            .map_or(&[], Vec::as_slice)
    }

    /// 反向：图节点归属的设备树投影起点 id。
    pub(crate) fn device_node_of(&self, graph_node_id: &str) -> Option<&str> {
        self.device_roots.get(graph_node_id).map(String::as_str)
    }

    /// 全部「设备树起点 → 派生子图」分组（按起点 id 升序）。
    pub(crate) fn device_subgraphs(&self) -> impl Iterator<Item = (&str, &[String])> + '_ {
        self.device_subgraphs
            .iter()
            .map(|(root, ids)| (root.as_str(), ids.as_slice()))
    }
}

/// 解析一个来源标记归属的设备树投影起点。
fn resolve_device_root(
    origins: &BTreeMap<String, NodeOrigin>,
    origin: &NodeOrigin,
) -> Option<String> {
    match origin {
        NodeOrigin::DeviceTree { root, .. } => Some(root.as_str().to_string()),
        NodeOrigin::Canvas => None,
        NodeOrigin::Derived { from } => resolve_derived_root(origins, from),
    }
}

/// 沿 `Derived` 链回溯到设备树起点；出现环（非法输入）时视为无设备树归属。
fn resolve_derived_root(origins: &BTreeMap<String, NodeOrigin>, from: &str) -> Option<String> {
    let mut current = from.to_string();
    let mut visited = BTreeSet::new();
    loop {
        if !visited.insert(current.clone()) {
            return None;
        }
        match origins.get(&current)? {
            NodeOrigin::DeviceTree { root, .. } => return Some(root.as_str().to_string()),
            NodeOrigin::Derived { from } => current = from.clone(),
            NodeOrigin::Canvas => return None,
        }
    }
}
