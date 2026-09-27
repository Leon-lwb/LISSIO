//! 系统提示词组装 — 基础工作约定 + 能力注册表知识库索引 + 用户补充指令。
//!
//! 索引只放标题与一句话用途 (省 token),全文经注册表的 `read_skill` 工具按需读;
//! 知识库清单从 [`CapabilityRegistry`] 动态派生,新增能力节点自带文档即自动入索引。

use control_api::capabilities::registry::CapabilityRegistry;
use control_api::capabilities::skill::Lang;

/// 组装启用内置工具时的系统提示词:基础约定 + 知识库索引 (来自能力注册表) +
/// 用户自填提示词。
#[must_use]
pub fn compose_system_prompt(
    registry: &CapabilityRegistry,
    lang: Lang,
    user: Option<&str>,
) -> String {
    use std::fmt::Write as _;

    let mut out = match lang {
        Lang::Zh => String::from(
            "你是 Lissio (串口/CAN/波形调试上位机) 的内置 AI 助手,可以调用内置工具\n\
             编辑节点图、操作软件、读取设备数据。工作约定:\n\
             - 编辑节点前先用 get_workspace 读当前画布状态;节点 id 一律来自读取结果,不要捏造。\n\
             - 小步修改:每做一次编辑,用对应读取工具 (get_graph_outputs / get_recent_waveform /\n\
               get_can_frames 等) 验证效果后再继续。\n\
             - 设备无数据时按序排查:连接状态 → get_raw_data 原始字节 → 连线与协议配置。\n\
             - 用中文与用户交流 (除非用户使用其他语言)。\n",
        ),
        Lang::En => String::from(
            "You are the built-in AI assistant of Lissio (a serial/CAN/waveform debugging\n\
             host app). You can call built-in tools to edit the node graph, operate the app,\n\
             and read device data. Working conventions:\n\
             - Call get_workspace before editing the graph; only use node ids from read results.\n\
             - Edit in small steps: verify each edit with the matching read tool\n\
               (get_graph_outputs / get_recent_waveform / get_can_frames ...) before continuing.\n\
             - For \"no data\", triage in order: connection state → get_raw_data raw bytes →\n\
               wiring and protocol config.\n\
             - Reply in the user's language.\n",
        ),
    };

    // 知识库索引 (标题 + 一句话用途, 全文按需 read_skill) — 从能力注册表动态派生
    out.push_str(match lang {
        Lang::Zh => "\n可用知识库 (read_skill 工具按需读取全文):\n",
        Lang::En => "\nKnowledge base (read full text via the read_skill tool):\n",
    });
    for (_, s) in registry.skills() {
        // String 的 write! 实现不会失败, 直接忽略返回值
        let _ = writeln!(out, "- {}: {} — {}", s.id, s.title(lang), s.summary(lang));
    }

    if let Some(user) = user.map(str::trim).filter(|s| !s.is_empty()) {
        out.push_str(match lang {
            Lang::Zh => "\n---\n用户自定义补充指令:\n",
            Lang::En => "\n---\nUser-provided additional instructions:\n",
        });
        out.push_str(user);
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// 提示词: 含约定 + 注册表知识库索引;用户提示词追加在后。
    #[test]
    fn system_prompt_composition() {
        let registry = Arc::new(CapabilityRegistry::builtin());
        let zh = compose_system_prompt(&registry, Lang::Zh, Some("  自定义:波特率默认 9600  "));
        assert!(zh.contains("get_workspace"));
        assert!(zh.contains("- overview:"));
        assert!(zh.contains("- protocols:"));
        assert!(zh.contains("自定义:波特率默认 9600"));
        assert!(zh.find("自定义").unwrap() > zh.find("- overview:").unwrap());

        let en = compose_system_prompt(&registry, Lang::En, None);
        assert!(en.contains("Knowledge base"));
        assert!(!en.contains("用户自定义"));
    }
}
