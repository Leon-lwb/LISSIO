//! 知识库能力节点 — 技能文档索引与全文读取 (跨节点自省)。
//!
//! `list_skills` / `read_skill` 从 [`ToolContext::registry`] 动态派生全部节点的
//! 自带文档,内置 AI 与外部 MCP 客户端走同一实现。

use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::json;

use super::node::CapabilityNode;
use super::skill::{Lang, SkillDoc};
use super::tool::{ToolError, ToolOutput, tool, tool0};

/// 技能文档读取入参。
#[derive(Debug, Deserialize, JsonSchema)]
struct ReadSkillParams {
    /// 文档 id (list_skills 返回)。
    skill_id: String,
    /// 文档语言 ("zh"/"en", 缺省跟随会话语言)。
    lang: Option<String>,
}

/// 软件与核心概念总览文档。
const fn overview_doc() -> SkillDoc {
    SkillDoc {
        id: "overview",
        title_zh: "软件与核心概念总览",
        title_en: "Software & Core Concepts Overview",
        summary_zh: "软件定位、字节/数值双平面、页签节点文档与数据流",
        summary_en: "App purpose, byte/value planes, tab-owned node documents, data flow",
        md_zh: include_str!("docs/zh/overview.md"),
        md_en: include_str!("docs/en/overview.md"),
    }
}

/// 设备调试实战手册文档。
const fn debug_recipes_doc() -> SkillDoc {
    SkillDoc {
        id: "debug-recipes",
        title_zh: "设备调试实战手册",
        title_en: "Device Debugging Playbook",
        summary_zh: "连接设备→解析→绘图、无硬件调试、无数据排查、CAN 调试等任务套路",
        summary_en: "Connect→parse→plot, hardware-less debug, no-data triage, CAN",
        md_zh: include_str!("docs/zh/debug-recipes.md"),
        md_en: include_str!("docs/en/debug-recipes.md"),
    }
}

/// 内置工具使用指南文档。
const fn tools_guide_doc() -> SkillDoc {
    SkillDoc {
        id: "tools-guide",
        title_zh: "内置工具使用指南",
        title_en: "Built-in Tools Guide",
        summary_zh: "工具清单、先读后写工作流、上限与注意事项",
        summary_en: "Tool inventory, read-before-write workflow, caps & caveats",
        md_zh: include_str!("docs/zh/tools-guide.md"),
        md_en: include_str!("docs/en/tools-guide.md"),
    }
}

/// 构造知识库能力节点。
#[must_use]
pub fn node() -> CapabilityNode {
    CapabilityNode {
        id: "knowledge",
        title_zh: "使用知识库",
        title_en: "Usage knowledge base",
        summary_zh: "软件总览、调试套路与工具指南等技能文档的索引与全文读取",
        summary_en: "Index and full text of overview, debugging playbook and tools guide",
        tools: vec![
            tool0(
                "list_skills",
                "列出全部技能文档索引 [{id, title, summary}] (文档挂在各能力节点下)",
                |ctx| async move {
                    let lang = ctx.lang;
                    let skills: Vec<_> = ctx
                        .registry
                        .skills()
                        .map(|(_, s)| {
                            json!({"id": s.id, "title": s.title(lang), "summary": s.summary(lang)})
                        })
                        .collect();
                    Ok(ToolOutput::Json(json!({ "skills": skills })))
                },
            ),
            tool(
                "read_skill",
                "读取技能文档全文 (id 见 list_skills 或系统提示词索引)",
                |ctx, p: ReadSkillParams| async move {
                    let lang = p.lang.as_deref().map_or(ctx.lang, Lang::parse);
                    let doc = ctx.registry.find_skill(&p.skill_id).ok_or_else(|| {
                        ToolError::Failed(format!("未知 skill id: {}", p.skill_id))
                    })?;
                    Ok(ToolOutput::Text(doc.md(lang).to_string()))
                },
            ),
        ],
        skills: vec![overview_doc(), debug_recipes_doc(), tools_guide_doc()],
    }
}

#[cfg(test)]
#[path = "knowledge_tests.rs"]
mod tests;
