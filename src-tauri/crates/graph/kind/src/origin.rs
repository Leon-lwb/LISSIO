//! 编译结果 provenance — 图节点「来自哪里」的标记。
//!
//! 编译产物 [`crate::NodeDef`] 除了业务语义 (`kind`) 之外，还携带来源标记
//! [`NodeOrigin`]，使 [`crate::NodeDef`] 的消费方能够区分:
//!
//! - 由设备树投影派生的节点（协议引擎子节点、设备根节点）；
//! - 画布上手写连线的节点（控件、手连协议、点位选择器）；
//! - 由另一图节点派生的节点（注入的协议帧源等）。
//!
//! 该标记只描述「来源」，不携带运行时状态；编译图据此建立 provenance 索引。

use data_model::device_tree::{NodeId, NodePath, NodeRole};
use serde::{Deserialize, Serialize};

/// 图节点的来源标记。
///
/// 缺省值为 [`NodeOrigin::Canvas`]：未显式标注来源的节点按画布手写节点处理，
/// 使既有的节点构造路径在语义上保持不变。
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NodeOrigin {
    /// 由设备树投影派生。
    DeviceTree {
        /// 对应的设备树节点身份（持久化身份，改名不变）。
        #[serde(rename = "nodeId")]
        node_id: NodeId,
        /// 节点在设备树中的绝对路径，仅用于展示与日志。
        path: NodePath,
        /// 节点角色。协议引擎子节点恒为 [`NodeRole::Protocol`]；
        /// 设备根节点的角色由驱动清单声明，投影层暂时无法取得时为 `None`。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        role: Option<NodeRole>,
        /// 本次投影起点（设备树根节点）的身份 — 支撑「按设备树节点取其派生子图」。
        root: NodeId,
        /// 设备树中的父节点身份；根节点为 `None`。
        #[serde(default, skip_serializing_if = "Option::is_none")]
        parent: Option<NodeId>,
    },
    /// 画布手写节点。
    #[default]
    Canvas,
    /// 由另一个图节点派生，`from` 为源图节点的 id。
    Derived {
        /// 源图节点 id。
        from: String,
    },
}

impl NodeOrigin {
    /// 若该节点由设备树派生（或由设备树派生节点继续派生），返回其投影起点的根节点身份。
    ///
    /// [`NodeOrigin::Derived`] 的归属需要编译图的派生索引解析，此处只回答
    /// 直接标注为设备树的情况。
    pub const fn root_device_node(&self) -> Option<&NodeId> {
        match self {
            Self::DeviceTree { root, .. } => Some(root),
            Self::Canvas | Self::Derived { .. } => None,
        }
    }

    /// 是否为画布手写节点。
    pub const fn is_canvas(&self) -> bool {
        matches!(self, Self::Canvas)
    }
}

#[cfg(test)]
#[path = "origin_tests.rs"]
mod tests;
