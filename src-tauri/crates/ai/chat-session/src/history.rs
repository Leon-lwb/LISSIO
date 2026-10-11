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
#[path = "history_tests.rs"]
mod tests;
