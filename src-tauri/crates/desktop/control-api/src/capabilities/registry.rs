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
#[path = "registry_tests.rs"]
mod tests;
