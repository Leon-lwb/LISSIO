//! 字节平面编译产物 (BytePlan)
//!
//! 字节平面与值平面 (f32/字符串槽位) 相互独立:
//! - 字节边 (两端端口域均为 Bytes, 或 RawData 字节标记边) 携带 `Vec<u8>`,
//!   事件驱动, 由调用方 (data_plane) 按 [`BytePlan::order`] 拓扑序逐节点 dispatch
//! - 跨平面不构成循环: 平面投影只看本平面边 (见 `plane` 模块), 结构性保证
//!
//! 字节平面节点 = Transport / Protocol 节点 ∪ 字节边端点
//! (FrameDecoder 字节入口 / widget loopbackOut 出口等)。

use std::collections::HashMap;

use petgraph::visit::{EdgeRef, IntoEdgeReferences};
use rustc_hash::FxHashSet;

use crate::plane::byte_plane_order;
use hir::{CompileError, EdgeClass, TypedGraph};

/// 字节路由 — 一条字节边的下游端点
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ByteRoute {
    /// 下游节点 id
    pub target: String,
    /// 下游节点的字节输入 handle (如 "in" / "tx")
    pub target_handle: String,
}

/// 字节平面处理计划
#[derive(Debug, Clone, Default)]
pub struct BytePlan {
    /// 字节节点处理顺序 (拓扑序, 上游在前)
    pub order: Vec<String>,
    /// 字节源节点 → 下游路由列表 (按 source 节点聚合)
    pub consumers: HashMap<String, Vec<ByteRoute>>,
    /// 平面成员集 (contains O(1) 查询)
    members: FxHashSet<String>,
}

impl BytePlan {
    /// 编译字节平面: 平面投影拓扑排序 (见 [`byte_plane_order`]) + 聚合 consumers
    ///
    /// 字节平面内循环 → [`CompileError::ByteCycle`] (完整环路径);
    /// 跨平面边不构成循环 (各平面只看本平面边)。
    ///
    /// consumers 仅覆盖真正传输字节的 [`EdgeClass::Byte`] 边。
    /// RawDataMarker(Bytes) 只参与拓扑/连接校验，视图通过 RawDataCollector 旁路订阅，
    /// 不是可执行消费者。
    pub fn build(g: &TypedGraph) -> Result<Self, CompileError> {
        // consumers: source → 下游路由
        let mut consumers: HashMap<String, Vec<ByteRoute>> = HashMap::new();
        for er in g.graph.edge_references() {
            if er.weight().class == EdgeClass::Byte {
                consumers
                    .entry(g.id_of(er.source()).to_string())
                    .or_default()
                    .push(ByteRoute {
                        target: g.id_of(er.target()).to_string(),
                        target_handle: er.weight().target_handle.clone(),
                    });
            }
        }

        let order: Vec<String> = byte_plane_order(g)?
            .iter()
            .map(|&ix| g.id_of(ix).to_string())
            .collect();
        let members: FxHashSet<String> = order.iter().cloned().collect();

        Ok(Self {
            order,
            consumers,
            members,
        })
    }

    /// 查询某字节源节点的下游路由 (无下游返回空切片)
    pub fn routes_for(&self, source: &str) -> &[ByteRoute] {
        self.consumers.get(source).map_or(&[], Vec::as_slice)
    }

    /// 节点是否属于字节平面 (O(1))
    pub fn contains(&self, node_id: &str) -> bool {
        self.members.contains(node_id)
    }
}

#[cfg(test)]
#[path = "byte_plan_tests.rs"]
mod tests;
