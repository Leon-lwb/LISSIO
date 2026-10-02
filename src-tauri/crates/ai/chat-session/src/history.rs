//! 视图条目流 → LLM 消息历史派生。
//!
//! 历史的所有权在后端:会话以视图条目形式落盘, 发起对话时由此模块
//! 派生 LLM 所需的消息序列 (与原前端 `exchangeToHistory` 语义一致, 并修正
//! 一处配对问题 — 未完成的工具调用从 `tool_calls` 中整体剔除, 保证
//! assistant.tool_calls 与 tool 结果消息一一对应)。

use llm::{ChatMessageDto, ChatRoleDto, ToolCallDto};

use crate::types::{ViewItemDto, ViewRoleDto};

/// 将 UI 使用的 UTF-16 位置转换为安全的 UTF-8 字节边界。
fn byte_offset_at_utf16(text: &str, target: usize) -> usize {
    let mut units = 0;
    for (byte, ch) in text.char_indices() {
        if units >= target {
            return byte;
        }
        units += ch.len_utf16();
        if units > target {
            return byte + ch.len_utf8();
        }
    }
    text.len()
}

/// 从视图条目派生完整对话历史。
///
/// 规则:
/// - user 条目 → user 消息 (附件依序以标注块并入消息文本)
/// - assistant 条目 → assistant 消息 (带已完成工具的 tool_calls) + 逐个 tool 结果
/// - `error` 条目仅用于 UI 展示, 不入历史
/// - 未收到结果的工具调用 (`done == false`) 连同结果一起剔除, 避免悬空调用
pub fn derive_history(items: &[ViewItemDto]) -> Vec<ChatMessageDto> {
    let mut out = Vec::new();
    for item in items {
        match item.role {
            ViewRoleDto::User => {
                let mut content = item.text.clone();
                for att in item.attachments.as_deref().unwrap_or_default() {
                    if !content.is_empty() {
                        content.push_str("\n\n");
                    }
                    content.push_str("--- Attached file: ");
                    content.push_str(&att.name);
                    content.push_str(" ---\n");
                    content.push_str(&att.content);
                }
                out.push(ChatMessageDto {
                    role: ChatRoleDto::User,
                    content,
                    tool_calls: None,
                    tool_call_id: None,
                    name: None,
                });
            }
            ViewRoleDto::Assistant => {
                if item.error == Some(true) {
                    continue;
                }
                let runs = item.tools.as_deref().unwrap_or_default();
                let finished: Vec<&crate::types::ToolRunDto> =
                    runs.iter().take_while(|run| run.done).collect();
                let mut cursor = 0;
                let mut index = 0;
                while index < finished.len() {
                    let offset =
                        byte_offset_at_utf16(&item.text, finished[index].text_offset).max(cursor);
                    let mut group_end = index + 1;
                    while group_end < finished.len()
                        && finished[group_end].text_offset == finished[index].text_offset
                    {
                        group_end += 1;
                    }
                    let group = &finished[index..group_end];
                    out.push(ChatMessageDto {
                        role: ChatRoleDto::Assistant,
                        content: item.text[cursor..offset].to_string(),
                        tool_calls: Some(
                            group
                                .iter()
                                .map(|run| ToolCallDto {
                                    id: run.id.clone(),
                                    name: run.name.clone(),
                                    arguments: run.arguments.clone(),
                                })
                                .collect(),
                        ),
                        tool_call_id: None,
                        name: None,
                    });
                    for run in group {
                        out.push(ChatMessageDto {
                            role: ChatRoleDto::Tool,
                            content: run.content.clone(),
                            tool_calls: None,
                            tool_call_id: Some(run.id.clone()),
                            name: Some(run.name.clone()),
                        });
                    }
                    cursor = offset;
                    index = group_end;
                }
                if cursor < item.text.len() {
                    out.push(ChatMessageDto {
                        role: ChatRoleDto::Assistant,
                        content: item.text[cursor..].to_string(),
                        tool_calls: None,
                        tool_call_id: None,
                        name: None,
                    });
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{AttachmentDto, ToolRunDto};
    use serde_json::json;

    fn user(text: &str) -> ViewItemDto {
        ViewItemDto {
            role: ViewRoleDto::User,
            text: text.to_string(),
            attachments: None,
            tools: None,
            timeline: None,
            reasoning: None,
            duration_ms: None,
            error: None,
            error_kind: None,
            error_data: None,
        }
    }

    fn assistant(text: &str) -> ViewItemDto {
        ViewItemDto {
            role: ViewRoleDto::Assistant,
            text: text.to_string(),
            attachments: None,
            tools: None,
            timeline: None,
            reasoning: None,
            duration_ms: None,
            error: None,
            error_kind: None,
            error_data: None,
        }
    }

    fn run(id: &str, done: bool) -> ToolRunDto {
        ToolRunDto {
            id: id.to_string(),
            name: "probe".to_string(),
            arguments: json!({}),
            text_offset: 0,
            content: if done {
                "42".to_string()
            } else {
                String::new()
            },
            is_error: false,
            done,
        }
    }

    #[test]
    fn plain_exchange_maps_two_messages() {
        let items = vec![user("你好"), assistant("你好!")];
        let history = derive_history(&items);
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].role, ChatRoleDto::User);
        assert_eq!(history[0].content, "你好");
        assert_eq!(history[1].role, ChatRoleDto::Assistant);
        assert!(history[1].tool_calls.is_none());
    }

    #[test]
    fn reasoning_only_item_is_not_sent_back_to_model() {
        let mut thought = assistant("");
        thought.reasoning = Some("内部推理".to_string());
        let history = derive_history(&[user("你好"), thought]);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].role, ChatRoleDto::User);
    }

    /// 流式中途落盘的空文本助手条目不产生历史消息 — 部分快照不会污染 LLM 上下文。
    #[test]
    fn empty_assistant_placeholder_is_harmless() {
        let history = derive_history(&[user("你好"), assistant("")]);
        assert_eq!(history.len(), 1);
    }

    /// 中断回合里已被收束的工具调用仍与结果成对, 不产生悬空 `tool_calls`。
    #[test]
    fn finalized_partial_tool_call_stays_paired() {
        let mut interrupted = assistant("");
        interrupted.tools = Some(vec![run("c1", true)]);
        let history = derive_history(&[user("执行"), interrupted]);
        assert_eq!(history.len(), 3);
        assert_eq!(history[1].role, ChatRoleDto::Assistant);
        assert_eq!(history[1].tool_calls.as_ref().map(Vec::len), Some(1));
        assert_eq!(history[2].role, ChatRoleDto::Tool);
        assert_eq!(history[2].tool_call_id.as_deref(), Some("c1"));
    }

    #[test]
    fn finished_tool_calls_pair_with_results() {
        let items = vec![
            user("查一下"),
            ViewItemDto {
                role: ViewRoleDto::Assistant,
                text: String::new(),
                attachments: None,
                tools: Some(vec![run("c1", true)]),
                timeline: None,
                reasoning: None,
                duration_ms: None,
                error: None,
                error_kind: None,
                error_data: None,
            },
            assistant("结果是 42"),
        ];
        let history = derive_history(&items);
        assert_eq!(history.len(), 4);
        assert_eq!(history[1].role, ChatRoleDto::Assistant);
        assert_eq!(history[1].tool_calls.as_ref().map(Vec::len), Some(1));
        assert_eq!(history[2].role, ChatRoleDto::Tool);
        assert_eq!(history[2].tool_call_id.as_deref(), Some("c1"));
        assert_eq!(history[2].content, "42");
        assert_eq!(history[3].content, "结果是 42");
    }

    #[test]
    fn text_and_tool_results_keep_their_original_order() {
        let mut item = assistant("😀先后结束");
        item.tools = Some(vec![
            ToolRunDto {
                text_offset: 3,
                ..run("c1", true)
            },
            ToolRunDto {
                text_offset: 4,
                ..run("c2", true)
            },
        ]);

        let history = derive_history(&[user("执行"), item]);
        assert_eq!(history.len(), 6);
        assert_eq!(history[1].content, "😀先");
        assert_eq!(history[1].tool_calls.as_ref().unwrap()[0].id, "c1");
        assert_eq!(history[2].role, ChatRoleDto::Tool);
        assert_eq!(history[2].tool_call_id.as_deref(), Some("c1"));
        assert_eq!(history[3].content, "后");
        assert_eq!(history[3].tool_calls.as_ref().unwrap()[0].id, "c2");
        assert_eq!(history[4].role, ChatRoleDto::Tool);
        assert_eq!(history[4].tool_call_id.as_deref(), Some("c2"));
        assert_eq!(history[5].content, "结束");
        assert!(history[5].tool_calls.is_none());
    }

    /// 未完成的工具调用整体剔除 (不产生悬空 tool_calls);
    /// error 条目不进历史。
    #[test]
    fn unfinished_tools_and_error_items_are_skipped() {
        let items = vec![
            user("hi"),
            ViewItemDto {
                role: ViewRoleDto::Assistant,
                text: "partial".to_string(),
                attachments: None,
                tools: Some(vec![run("c1", false)]),
                timeline: None,
                reasoning: None,
                duration_ms: None,
                error: None,
                error_kind: None,
                error_data: None,
            },
            ViewItemDto {
                role: ViewRoleDto::Assistant,
                text: "请求失败".to_string(),
                attachments: None,
                tools: None,
                timeline: None,
                reasoning: None,
                duration_ms: None,
                error: Some(true),
                error_kind: Some("AiProviderRequest".to_string()),
                error_data: None,
            },
        ];
        let history = derive_history(&items);
        assert_eq!(history.len(), 2);
        assert_eq!(history[1].role, ChatRoleDto::Assistant);
        assert_eq!(history[1].content, "partial");
        assert!(history[1].tool_calls.is_none());
    }

    /// 附件依序以标注块并入 user 消息文本 (空文本时省略前置空行)。
    #[test]
    fn user_attachments_are_inlined_into_message_text() {
        let mut item = user("帮我看看这两个文件");
        item.attachments = Some(vec![
            AttachmentDto {
                name: "main.rs".to_string(),
                content: "fn main() {}".to_string(),
            },
            AttachmentDto {
                name: "notes.md".to_string(),
                content: "# 笔记".to_string(),
            },
        ]);
        let history = derive_history(&[item]);
        assert_eq!(history.len(), 1);
        assert_eq!(
            history[0].content,
            "帮我看看这两个文件\n\n--- Attached file: main.rs ---\nfn main() {}\n\n\
             --- Attached file: notes.md ---\n# 笔记"
        );
    }

    /// 仅附件无文本时消息以附件标注块开头;无附件条目文本原样透传。
    #[test]
    fn attachment_only_entry_and_plain_entry() {
        let mut attached = user("");
        attached.attachments = Some(vec![AttachmentDto {
            name: "data.csv".to_string(),
            content: "a,b\n1,2".to_string(),
        }]);
        let history = derive_history(&[attached, user("plain")]);
        assert_eq!(
            history[0].content,
            "--- Attached file: data.csv ---\na,b\n1,2"
        );
        assert_eq!(history[1].content, "plain");
    }
}
