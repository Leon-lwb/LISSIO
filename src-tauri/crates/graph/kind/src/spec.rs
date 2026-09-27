//! 节点规格（spec）— IPC 节点定义 `NodeDef` + 端口命名派生助手.
//!
//! 与前端 `src/lib/utils/nodeDef.ts` 的类型镜像对齐:
//! `{ id: string, tab_id: string, kind: NodeKind, origin: NodeOrigin }`.
//!
//! `origin` 是编译期 provenance 标记（见 [`crate::NodeOrigin`]），不是持久化字段；
//! 缺省为画布手写节点，使未显式标注的构造路径语义不变。

use serde::{Deserialize, Serialize};

use crate::kind::NodeKind;
use crate::origin::NodeOrigin;

/// 节点定义 — 通过 IPC 从前端同步到后端
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
pub struct NodeDef {
    pub id: String,
    pub tab_id: String,
    pub kind: NodeKind,
    /// 来源标记 — 设备树派生 / 画布手写 / 由其它节点派生。
    #[serde(default)]
    pub origin: NodeOrigin,
}

impl NodeDef {
    /// 构造一个画布手写节点定义（前端镜像构造常用入口）
    pub const fn new(id: String, tab_id: String, kind: NodeKind) -> Self {
        Self {
            id,
            tab_id,
            kind,
            origin: NodeOrigin::Canvas,
        }
    }

    /// 构造一个带显式来源标记的节点定义
    pub const fn with_origin(
        id: String,
        tab_id: String,
        kind: NodeKind,
        origin: NodeOrigin,
    ) -> Self {
        Self {
            id,
            tab_id,
            kind,
            origin,
        }
    }

    /// 构造一个由 `from` 节点派生的节点定义
    pub fn derived(from: impl Into<String>, id: String, tab_id: String, kind: NodeKind) -> Self {
        Self::with_origin(id, tab_id, kind, NodeOrigin::Derived { from: from.into() })
    }

    /// 节点 id 的字符串视图
    pub fn id_str(&self) -> &str {
        &self.id
    }

    /// tab id 的字符串视图
    pub fn tab_id_str(&self) -> &str {
        &self.tab_id
    }

    /// 来源标记的共享视图
    pub const fn origin(&self) -> &NodeOrigin {
        &self.origin
    }
}

/// 解析 ProtocolSource 的输出端口名列表（编译/求值共用）
///
/// `port_names` 非空项优先（越界/空名回退 `"ch{i}"`），缺省 `"ch0".."chN"`
pub fn protocol_source_port_names(port_names: &[String], channels: usize) -> Vec<String> {
    (0..channels)
        .map(|i| {
            port_names
                .get(i)
                .filter(|p| !p.is_empty())
                .cloned()
                .unwrap_or_else(|| format!("ch{i}"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_defaults_to_canvas_origin() {
        let node = NodeDef::new("n1".into(), "tab".into(), NodeKind::Input);
        assert!(node.origin().is_canvas());
        assert_eq!(node.id_str(), "n1");
        assert_eq!(node.tab_id_str(), "tab");
    }

    #[test]
    fn derived_constructor_marks_its_source() {
        let node = NodeDef::derived("proto", "proto".into(), "tab".into(), NodeKind::Input);
        assert_eq!(
            node.origin(),
            &NodeOrigin::Derived {
                from: "proto".to_string()
            }
        );
    }

    #[test]
    fn missing_origin_field_deserializes_as_canvas() {
        let wire = serde_json::json!({
            "id": "n1",
            "tab_id": "tab",
            "kind": { "kind": "Input", "params": null },
        });
        let node: NodeDef = serde_json::from_value(wire).expect("legacy-shaped payload parses");
        assert!(node.origin().is_canvas());
    }

    #[test]
    fn origin_round_trips_through_wire() {
        let node = NodeDef::with_origin(
            "n1".into(),
            "tab".into(),
            NodeKind::Input,
            NodeOrigin::Derived {
                from: "proto".into(),
            },
        );
        let wire = serde_json::to_value(&node).expect("node serializes");
        let back: NodeDef = serde_json::from_value(wire).expect("node deserializes");
        assert_eq!(back.origin, node.origin);
    }
}
