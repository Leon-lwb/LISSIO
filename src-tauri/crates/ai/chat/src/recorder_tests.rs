use super::*;
use serde_json::json;

fn tool_call(id: &str) -> AiChatEvent {
    AiChatEvent::ToolCall {
        id: id.to_string(),
        name: "probe".to_string(),
        arguments: json!({"value": 7}),
    }
}

fn tool_result(id: &str, is_error: bool) -> AiChatEvent {
    AiChatEvent::ToolResult {
        id: id.to_string(),
        name: "probe".to_string(),
        content: "42".to_string(),
        is_error,
    }
}

#[test]
fn aggregates_text_and_tools_into_one_item() {
    let mut rec = TurnRecorder::new();
    rec.record(&AiChatEvent::ReasoningDelta {
        text: "分析问题".into(),
    });
    rec.record(&AiChatEvent::Delta {
        text: "你好".into(),
    });
    rec.record(&tool_call("c1"));
    rec.record(&tool_result("c1", false));
    rec.record(&AiChatEvent::Done { rounds: 2 });

    let items = rec.finish();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].role, ViewRoleDto::Assistant);
    assert_eq!(items[0].text, "你好");
    assert_eq!(items[0].reasoning.as_deref(), Some("分析问题"));
    assert!(items[0].duration_ms.is_some());
    let tools = items[0].tools.as_ref().unwrap();
    assert_eq!(tools.len(), 1);
    assert!(tools[0].done);
    assert!(!tools[0].is_error);
    assert_eq!(tools[0].content, "42");
    assert_eq!(tools[0].text_offset, 2);
}

#[test]
fn records_tool_positions_between_text_chunks_in_utf16() {
    let mut rec = TurnRecorder::new();
    rec.record(&AiChatEvent::Delta {
        text: "😀先".into(),
    });
    rec.record(&tool_call("c1"));
    rec.record(&tool_result("c1", false));
    rec.record(&AiChatEvent::Delta { text: "后".into() });
    rec.record(&tool_call("c2"));
    let tools = rec.finish().remove(0).tools.unwrap();
    assert_eq!(tools[0].text_offset, 3);
    assert_eq!(tools[1].text_offset, 4);
}

#[test]
fn preserves_reasoning_and_tool_order_across_model_rounds() {
    let mut rec = TurnRecorder::new();
    rec.record(&AiChatEvent::ReasoningDelta {
        text: "先想".into(),
    });
    rec.record(&tool_call("c1"));
    rec.record(&tool_result("c1", false));
    rec.record(&AiChatEvent::ReasoningDelta {
        text: "再想".into(),
    });
    rec.record(&AiChatEvent::Delta {
        text: "结论".into(),
    });
    let timeline = rec.finish().remove(0).timeline.unwrap();
    assert_eq!(
        timeline,
        vec![
            TurnEventDto::Reasoning {
                text: "先想".into()
            },
            TurnEventDto::Tool { id: "c1".into() },
            TurnEventDto::Reasoning {
                text: "再想".into()
            },
            TurnEventDto::Text {
                text: "结论".into()
            },
        ]
    );
}

/// Error 事件产出独立 error 条目 (排在回合条目之后, 与前端一致),
/// kind / 结构化字段随条目持久化供前端本地化。
#[test]
fn error_event_produces_error_item() {
    let mut rec = TurnRecorder::new();
    rec.record(&AiChatEvent::Delta {
        text: "part".into(),
    });
    rec.record(&AiChatEvent::Error {
        message: "LLM 请求失败 [orcarouter/openai/gpt-4o-mini]: 401".into(),
        kind: "AiProviderRequest".into(),
        data: serde_json::json!({"adapter": "orcarouter", "model": "openai/gpt-4o-mini"}),
    });

    let items = rec.finish();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].text, "part");
    assert_eq!(
        items[1].text,
        "LLM 请求失败 [orcarouter/openai/gpt-4o-mini]: 401"
    );
    assert_eq!(items[1].error, Some(true));
    assert_eq!(items[1].error_kind.as_deref(), Some("AiProviderRequest"));
    let data = items[1].error_data.as_ref().unwrap();
    assert_eq!(data.get("adapter").map(String::as_str), Some("orcarouter"));
    assert_eq!(
        data.get("model").map(String::as_str),
        Some("openai/gpt-4o-mini")
    );
}

/// 缺少 kind 的旧事件 → error_kind 不落盘 (前端回退显示原始描述)。
#[test]
fn error_without_kind_keeps_raw_message_only() {
    let mut rec = TurnRecorder::new();
    rec.record(&AiChatEvent::Error {
        message: "boom".into(),
        kind: String::new(),
        data: Value::Null,
    });

    let items = rec.finish();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].text, "boom");
    assert!(items[0].error_kind.is_none());
    assert!(items[0].error_data.is_none());
}

/// 取消时未完成的工具调用收束为失败, 不残留"运行中"状态。
#[test]
fn unfinished_tools_finalized_as_failed() {
    let mut rec = TurnRecorder::new();
    rec.record(&AiChatEvent::Delta { text: "查".into() });
    rec.record(&tool_call("c1"));
    rec.record(&AiChatEvent::Cancelled);

    let items = rec.finish();
    assert_eq!(items.len(), 1);
    let tools = items[0].tools.as_ref().unwrap();
    assert!(tools[0].done);
    assert!(tools[0].is_error);
}

/// 空回合不产出条目。
#[test]
fn empty_turn_produces_nothing() {
    let mut rec = TurnRecorder::new();
    rec.record(&AiChatEvent::Done { rounds: 1 });
    assert!(rec.finish().is_empty());
}
