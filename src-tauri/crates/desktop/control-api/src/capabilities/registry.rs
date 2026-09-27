//! 能力注册表 — 全部软件能力节点的有序集合与查找索引。
//!
//! MCP 工具路由、内置 AI 工具规格与 skill 清单都从同一注册表运行期派生;
//! 构造时做完整性校验 (工具名/skill id 全局唯一、schema 为合法对象),
//! 重复注册是编程错误,直接拒绝装配。

use std::collections::HashMap;

use super::node::CapabilityNode;
use super::skill::SkillDoc;
use super::tool::ToolDefinition;

/// 注册表构造失败 (重复的工具名/skill id 或非法 schema)。
#[derive(Debug)]
pub enum RegistryError {
    /// 工具名跨节点重复。
    DuplicateTool {
        /// 重复的工具名。
        name: String,
        /// 已注册该名字的节点 id。
        nodes: Vec<&'static str>,
    },
    /// skill id 跨节点重复。
    DuplicateSkill {
        /// 重复的 skill id。
        id: String,
        /// 已注册该 id 的节点 id。
        nodes: Vec<&'static str>,
    },
    /// 工具 schema 不是 JSON 对象 (客户端要求 object schema)。
    InvalidSchema {
        /// 问题工具名。
        tool: &'static str,
    },
}

impl std::fmt::Display for RegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DuplicateTool { name, nodes } => {
                write!(f, "工具名 {name} 在节点 {nodes:?} 重复注册")
            }
            Self::DuplicateSkill { id, nodes } => {
                write!(f, "skill id {id} 在节点 {nodes:?} 重复注册")
            }
            Self::InvalidSchema { tool } => write!(f, "工具 {tool} 的 schema 不是 JSON 对象"),
        }
    }
}

impl std::error::Error for RegistryError {}

/// 软件能力节点注册表 — 不可变,构造后只读。
pub struct CapabilityRegistry {
    nodes: Vec<CapabilityNode>,
    /// 工具名 → (节点下标, 工具下标)。
    tool_index: HashMap<&'static str, (usize, usize)>,
    /// skill id → (节点下标, 文档下标)。
    skill_index: HashMap<&'static str, (usize, usize)>,
}

impl CapabilityRegistry {
    /// 内置软件能力全集 — 静态装配,完整性由单元测试兜底。
    ///
    /// # Panics
    /// 内置节点静态有效;重复工具名/skill id 是编程错误,测试保证不会发生。
    #[must_use]
    pub fn builtin() -> Self {
        Self::new(vec![
            super::acquisition::node(),
            super::can::node(),
            super::command::node(),
            super::graph::node(),
            super::knowledge::node(),
            super::logic::node(),
            super::recording::node(),
            super::transport::node(),
            super::waveform::node(),
        ])
        .expect("内置能力节点注册表静态有效")
    }

    /// 校验并装配注册表;重复工具名/skill id 或非法 schema 返回错误。
    ///
    /// # Errors
    /// 见 [`RegistryError`]。
    pub fn new(nodes: Vec<CapabilityNode>) -> Result<Self, RegistryError> {
        let mut tool_index = HashMap::new();
        let mut tool_owners: HashMap<&'static str, Vec<&'static str>> = HashMap::new();
        let mut skill_index = HashMap::new();
        let mut skill_owners: HashMap<&'static str, Vec<&'static str>> = HashMap::new();

        for (node_i, node) in nodes.iter().enumerate() {
            for (tool_i, t) in node.tools.iter().enumerate() {
                if !t.input_schema.is_object() {
                    return Err(RegistryError::InvalidSchema { tool: t.name });
                }
                tool_owners.entry(t.name).or_default().push(node.id);
                tool_index.insert(t.name, (node_i, tool_i));
            }
            for (skill_i, s) in node.skills.iter().enumerate() {
                skill_owners.entry(s.id).or_default().push(node.id);
                skill_index.insert(s.id, (node_i, skill_i));
            }
        }
        for (name, owners) in tool_owners {
            if owners.len() > 1 {
                return Err(RegistryError::DuplicateTool {
                    name: name.to_string(),
                    nodes: owners,
                });
            }
        }
        for (id, owners) in skill_owners {
            if owners.len() > 1 {
                return Err(RegistryError::DuplicateSkill {
                    id: id.to_string(),
                    nodes: owners,
                });
            }
        }
        Ok(Self {
            nodes,
            tool_index,
            skill_index,
        })
    }

    /// 全部能力节点 (注册顺序)。
    pub fn nodes(&self) -> &[CapabilityNode] {
        &self.nodes
    }

    /// 遍历全部工具及其所属节点。
    pub fn tools(&self) -> impl Iterator<Item = (&CapabilityNode, &ToolDefinition)> {
        self.nodes
            .iter()
            .flat_map(|n| n.tools.iter().map(move |t| (n, t)))
    }

    /// 按名查找工具及其所属节点。
    pub fn find_tool(&self, name: &str) -> Option<(&CapabilityNode, &ToolDefinition)> {
        let &(node_i, tool_i) = self.tool_index.get(name)?;
        Some((&self.nodes[node_i], &self.nodes[node_i].tools[tool_i]))
    }

    /// 遍历全部技能文档及其所属节点。
    pub fn skills(&self) -> impl Iterator<Item = (&CapabilityNode, &SkillDoc)> {
        self.nodes
            .iter()
            .flat_map(|n| n.skills.iter().map(move |s| (n, s)))
    }

    /// 按 id 查找技能文档。
    pub fn find_skill(&self, id: &str) -> Option<&SkillDoc> {
        let &(node_i, skill_i) = self.skill_index.get(id)?;
        Some(&self.nodes[node_i].skills[skill_i])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capabilities::skill::Lang;
    use crate::capabilities::tool::{ToolOutput, tool0};

    /// 内置注册表: 覆盖全部已知工具与文档,名字唯一,数量只增不减。
    #[test]
    fn builtin_registry_complete() {
        let reg = CapabilityRegistry::builtin();
        let mut names: Vec<_> = reg.tools().map(|(_, t)| t.name).collect();
        names.sort_unstable();
        for expected in [
            "close_endpoint",
            "compute_command_frame_bytes",
            "connect_edge",
            "create_waveform_snapshot",
            "create_recording_session",
            "delete_recording_session",
            "disconnect_edge",
            "export_recording_data",
            "export_waveform_csv",
            "flush_recording",
            "get_buffer_info",
            "get_can_frames",
            "get_graph_outputs",
            "get_logic_data",
            "get_raw_data",
            "get_recent_waveform",
            "get_recording_health",
            "get_waveform_window",
            "inject_bytes",
            "list_data_sources",
            "list_device_tree_nodes",
            "list_devices",
            "list_driver_manifests",
            "list_endpoints",
            "list_recording_bindings",
            "list_recording_sessions",
            "list_serial_ports",
            "list_skills",
            "list_tabs",
            "open_endpoint",
            "query_recording_history",
            "query_recording_sql",
            "query_waveform_snapshot",
            "read_points",
            "read_skill",
            "release_waveform_snapshot",
            "run_workspace",
            "send_bytes",
            "send_can_frame",
            "send_command_frame",
            "send_string",
            "set_input_value",
            "switch_recording_session",
            "update_graph",
            "write_points",
        ] {
            assert!(names.contains(&expected), "缺少内置工具 {expected}");
        }
        assert!(
            names.len() >= 45,
            "内置工具应不少于 45 个, 实际 {}",
            names.len()
        );

        let skill_ids: Vec<_> = reg.skills().map(|(_, s)| s.id).collect();
        for expected in [
            "overview",
            "nodes-reference",
            "protocols",
            "debug-recipes",
            "tools-guide",
        ] {
            assert!(skill_ids.contains(&expected), "缺少技能文档 {expected}");
        }
    }

    /// 内置注册表: schema 为对象、描述非空、每个工具可按名定位。
    #[test]
    fn builtin_registry_shape() {
        let reg = CapabilityRegistry::builtin();
        for (node, t) in reg.tools() {
            assert!(
                t.input_schema.is_object(),
                "{}.{} schema 非对象",
                node.id,
                t.name
            );
            assert_eq!(
                t.input_schema["type"], "object",
                "{}.{} schema 缺 type",
                node.id, t.name
            );
            assert!(!t.description.is_empty(), "{}.{} 描述为空", node.id, t.name);
            let (owner, found) = reg.find_tool(t.name).expect("按名可查");
            assert_eq!(owner.id, node.id);
            assert_eq!(found.name, t.name);
        }
        assert!(!reg.nodes().is_empty());
        assert!(reg.nodes().iter().all(|n| !n.title(Lang::En).is_empty()));
    }

    fn node(
        id: &'static str,
        tool_names: &[&'static str],
        skill_ids: &[&'static str],
    ) -> CapabilityNode {
        CapabilityNode {
            id,
            title_zh: id,
            title_en: id,
            summary_zh: id,
            summary_en: id,
            tools: tool_names
                .iter()
                .map(|&n| {
                    tool0(n, "测试工具", |_| async {
                        Ok(ToolOutput::Text(n.into()))
                    })
                })
                .collect(),
            skills: skill_ids
                .iter()
                .map(|&sid| SkillDoc {
                    id: sid,
                    title_zh: sid,
                    title_en: sid,
                    summary_zh: sid,
                    summary_en: sid,
                    md_zh: "正文",
                    md_en: "body",
                })
                .collect(),
        }
    }

    /// 查找:工具与 skill 命中所属节点,未知名返回 None。
    #[test]
    fn find_tool_and_skill() {
        let reg = CapabilityRegistry::new(vec![
            node("a", &["t1", "t2"], &["s1"]),
            node("b", &["t3"], &["s2"]),
        ])
        .expect("合法注册表");
        assert_eq!(reg.find_tool("t2").expect("命中").0.id, "a");
        assert_eq!(reg.find_tool("t3").expect("命中").0.id, "b");
        assert!(reg.find_tool("t9").is_none());
        assert_eq!(reg.find_skill("s2").expect("命中").id, "s2");
        assert!(reg.find_skill("s9").is_none());
        assert_eq!(reg.tools().count(), 3);
        assert_eq!(reg.skills().count(), 2);
        assert_eq!(reg.nodes()[1].title(Lang::En), "b");
    }

    /// 跨节点重复工具名拒绝装配。
    #[test]
    fn duplicate_tool_rejected() {
        let err = CapabilityRegistry::new(vec![node("a", &["dup"], &[]), node("b", &["dup"], &[])])
            .err()
            .expect("重复工具名");
        assert!(err.to_string().contains("dup"));
        assert!(matches!(err, RegistryError::DuplicateTool { .. }));
    }

    /// 跨节点重复 skill id 拒绝装配。
    #[test]
    fn duplicate_skill_rejected() {
        let err =
            CapabilityRegistry::new(vec![node("a", &["t"], &["dup"]), node("b", &[], &["dup"])])
                .err()
                .expect("重复 skill id");
        assert!(matches!(err, RegistryError::DuplicateSkill { .. }));
    }
}
