//! 能力节点 — 一个软件能力域的完整声明 (工具 + 技能文档)。
//!
//! 节点是注册表的一等单元:新增能力域 = 新增一个节点构造函数并加入
//! [`super::registry::CapabilityRegistry::builtin`],不需要改动任何出口代码。

use super::skill::{Lang, SkillDoc};
use super::tool::ToolDefinition;

/// 软件能力节点:某个能力域 (传输/图编辑/波形/CAN/录制/知识库...) 声明的
/// 全部工具与自带文档。
pub struct CapabilityNode {
    /// 稳定节点 id (如 "transport" / "graph" / "waveform")。
    pub id: &'static str,
    /// zh 节点标题 (提示词索引与 MCP instructions 用)。
    pub title_zh: &'static str,
    /// en 节点标题。
    pub title_en: &'static str,
    /// zh 一句话能力概述。
    pub summary_zh: &'static str,
    /// en 一句话能力概述。
    pub summary_en: &'static str,
    /// 该域暴露的工具。
    pub tools: Vec<ToolDefinition>,
    /// 该域自带的使用文档。
    pub skills: Vec<SkillDoc>,
}

impl CapabilityNode {
    /// 按语言取标题。
    #[must_use]
    pub const fn title(&self, lang: Lang) -> &'static str {
        match lang {
            Lang::Zh => self.title_zh,
            Lang::En => self.title_en,
        }
    }

    /// 按语言取能力概述。
    #[must_use]
    pub const fn summary(&self, lang: Lang) -> &'static str {
        match lang {
            Lang::Zh => self.summary_zh,
            Lang::En => self.summary_en,
        }
    }
}
