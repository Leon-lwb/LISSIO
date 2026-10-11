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
