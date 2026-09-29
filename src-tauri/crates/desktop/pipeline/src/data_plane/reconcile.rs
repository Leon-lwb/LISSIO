//! 孤儿资源清理 — 图重编译 (update_tab_graph / remove_tab_graph) 提交后调用
//!
//! 运行时节点索引是所有页签文档的合并视图；节点从其所属页签删除后才清理资源:
//! - 设备节点: 会话仍打开但运行时索引已不存在 → detach 读任务 + close 连接
//! - Protocol 节点: protocol_states / source_frames 由 `sync_protocol_states` 清理,
//!   本模块补清 buffers (key = Protocol 节点 id)
//! - raw_collectors (key = 设备节点 id): 无对应设备节点的键移除
//! - trigger_states (key = Trigger 节点 id): 已不存在于任一 tab 图的键移除
//! - 悬空 ProtocolSource (引用的 node_id 不是运行时索引中的 Protocol 节点):
//!   不编译失败, 仅 log::warn (按 graphs_version 去重, 每个图版本最多警告一次)

use std::collections::HashSet;
use std::sync::atomic::Ordering;

use kind::NodeKind;

use super::DataPlaneState;

/// 运行时节点索引快照: 设备节点 id 集 / Protocol 节点 id 集 /
/// 悬空 ProtocolSource 列表 (ProtocolSource 节点 id, 引用的 node_id) /
/// 存活 Trigger 节点 id 集 (trigger_states 清理依据)
struct NodeSets {
    devices: HashSet<String>,
    protocols: HashSet<String>,
    dangling_sources: Vec<(String, String)>,
    triggers: HashSet<String>,
}

/// 提取 reconcile 所需的键集 (锁内一次性快照):
/// 设备/Protocol 集合来自运行时节点索引；ProtocolSource 是页签数值平面的
/// 帧源引用 (不进运行时索引)，悬空检测扫描各页签编译图的节点表；
/// Trigger 同为 tab 数值平面节点, 存活集一并从编译图收集。
fn snapshot_node_sets(plane: &DataPlaneState) -> NodeSets {
    let nodes = plane.global_nodes.lock();
    let mut sets = NodeSets {
        devices: HashSet::new(),
        protocols: HashSet::new(),
        dangling_sources: Vec::new(),
        triggers: HashSet::new(),
    };
    for n in nodes.values() {
        match &n.kind {
            NodeKind::Acquisition { .. } => {
                sets.devices.insert(n.id.clone());
            }
            NodeKind::Protocol { .. } | NodeKind::PointSelector { .. } => {
                sets.protocols.insert(n.id.clone());
            }
            _ => {}
        }
    }
    // 悬空 ProtocolSource: 引用的 node_id 不是运行时索引中的 Protocol 节点
    for g in plane.eval.graphs.lock().values() {
        for n in g.value_nodes() {
            match &n.kind {
                NodeKind::ProtocolSource { node_id, .. } => {
                    let target_is_protocol = matches!(
                        nodes.get(node_id).map(|t| &t.kind),
                        Some(NodeKind::Protocol { .. })
                    );
                    if !target_is_protocol {
                        sets.dangling_sources.push((n.id.clone(), node_id.clone()));
                    }
                }
                NodeKind::Trigger { .. } => {
                    sets.triggers.insert(n.id.clone());
                }
                _ => {}
            }
        }
    }
    sets
}

impl DataPlaneState {
    /// 图重编译后的孤儿资源清理 (幂等, 每次 update/remove_tab_graph 提交后调用)
    ///
    /// 调用前应先执行 `sync_protocol_states` (protocol_states / source_frames 清理)。
    pub async fn reconcile(&self) {
        let sets = snapshot_node_sets(self);
        let nodes = self
            .global_nodes
            .lock()
            .values()
            .filter_map(|node| match &node.kind {
                NodeKind::Acquisition { node, .. } => Some(node.clone()),
                _ => None,
            })
            .collect::<Vec<_>>();
        for id in self.transport.reconcile(&nodes).await {
            self.detach(id.as_str());
            self.mark_source_disconnected(id.as_str());
        }

        // 悬空 ProtocolSource 警告 (不编译失败; 按 graphs_version 去重避免刷屏)
        if !sets.dangling_sources.is_empty() {
            let version = self.eval.graphs_version.load(Ordering::Relaxed);
            if self.reconcile_warn_version.swap(version, Ordering::Relaxed) != version {
                for (src, target) in &sets.dangling_sources {
                    log::warn!(
                        "ProtocolSource 节点 {src} 引用的 Protocol 节点 {target} 不存在 (已悬空, 输出保持最新缓存值)"
                    );
                }
            }
        }

        // 孤儿设备: 会话仍 open 但运行时索引已无该设备节点
        // → detach 读任务 + close 连接
        let orphans: Vec<data_model::device_tree::NodeId> = {
            let manager = &self.transport;
            manager
                .list_open()
                .into_iter()
                .filter(|id| !sets.devices.contains(id.as_str()))
                .collect()
        };
        if !orphans.is_empty() {
            let manager = &self.transport;
            for id in orphans {
                self.detach(id.as_str());
                manager.close(&id).await;
                log::info!("图重编译: 清理孤儿设备会话 {id}");
            }
        }

        // buffers: 仅保留仍存在的 Protocol 节点键
        self.buffers
            .lock()
            .retain(|id, _| sets.protocols.contains(id));
        // 容量整备记录与缓冲同源；节点反复增删时不可永久保留旧 id。
        self.tuned_rate
            .lock()
            .retain(|id, _| sets.protocols.contains(id));
        // raw_collectors: 仅保留仍存在的设备节点键
        self.raw_collectors
            .lock()
            .retain(|id, _| sets.devices.contains(id));
        // trigger_states: 仅保留仍存在于任一 tab 图的 Trigger 节点键 (节点删除清理)
        self.eval
            .trigger_states
            .lock()
            .retain(|id, _| sets.triggers.contains(id));
    }
}
