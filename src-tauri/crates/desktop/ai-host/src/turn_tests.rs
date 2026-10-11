use super::*;
use chat_session::{ViewItemDto, ViewRoleDto};
use parking_lot::Mutex;
use serde_json::json;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("lissio-ai-turn-{tag}-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    dir
}

fn user_item() -> ViewItemDto {
    ViewItemDto {
        role: ViewRoleDto::User,
        text: "问".to_string(),
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

/// 建一个带用户锚点的会话, 返回 (存储, 会话 id)。
fn anchored_store(dir: &std::path::Path) -> (Arc<SessionStore>, String) {
    let store = Arc::new(SessionStore::empty(dir));
    let session = store.create("会话").expect("新建会话");
    store
        .append_items(&session.id, vec![user_item()])
        .expect("追加用户条目");
    (store, session.id)
}

/// 收集前端推送事件的回调。
fn collector() -> (EventSink, Arc<Mutex<Vec<AiChatEvent>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink_events = Arc::clone(&events);
    let sink: EventSink = Arc::new(move |event| sink_events.lock().push(event));
    (sink, events)
}

fn pipeline(
    store: &Arc<SessionStore>,
    session_id: &str,
    frontend: EventSink,
    timing: Timing,
) -> TurnPipeline {
    TurnPipeline::spawn_with(
        frontend,
        TurnPersistence {
            sessions: Arc::clone(store),
            session_id: session_id.to_string(),
            periodic_drafts: true,
        },
        timing,
    )
}

/// 连续同类增量合并推送, 工具事件依次冲刷 — 无丢失、无乱序,
/// 且记录器产物与逐条消费完全一致。
#[tokio::test]
async fn coalesces_deltas_without_reordering() {
    let dir = temp_dir("coalesce");
    let (sessions, session_id) = anchored_store(&dir);
    let (frontend, events) = collector();
    let pipeline = pipeline(&sessions, &session_id, frontend, Timing::default());
    let sink = pipeline.sink();

    let stream = vec![
        AiChatEvent::ReasoningDelta {
            text: "想".to_string(),
        },
        AiChatEvent::Delta {
            text: "你".to_string(),
        },
        AiChatEvent::Delta {
            text: "好".to_string(),
        },
        AiChatEvent::ToolCall {
            id: "c1".to_string(),
            name: "probe".to_string(),
            arguments: json!({}),
        },
        AiChatEvent::Delta {
            text: "再见".to_string(),
        },
        AiChatEvent::ToolResult {
            id: "c1".to_string(),
            name: "probe".to_string(),
            content: "42".to_string(),
            is_error: false,
        },
        AiChatEvent::Done { rounds: 2 },
    ];
    let mut reference = TurnRecorder::new();
    for event in &stream {
        reference.record(event);
    }
    for event in stream {
        sink(event);
    }
    pipeline.finish().await;

    let seen = events.lock().clone();
    assert_eq!(seen.len(), 6, "合并后事件数: {seen:?}");
    assert!(matches!(&seen[0], AiChatEvent::ReasoningDelta { text } if text == "想"));
    assert!(matches!(&seen[1], AiChatEvent::Delta { text } if text == "你好"));
    assert!(matches!(&seen[2], AiChatEvent::ToolCall { id, .. } if id == "c1"));
    assert!(matches!(&seen[3], AiChatEvent::Delta { text } if text == "再见"));
    assert!(matches!(&seen[4], AiChatEvent::ToolResult { id, .. } if id == "c1"));
    assert!(matches!(&seen[5], AiChatEvent::Done { rounds: 2 }));

    // 落盘条目与「逐条喂给记录器」的结果一致 (时长按写入时刻计, 比较时忽略)
    let mut expected = reference.finish();
    let mut items = sessions.get(&session_id).unwrap().items;
    assert_eq!(items.len(), 2, "只有一条助手条目: {items:?}");
    for item in expected.iter_mut().chain(items.iter_mut()) {
        item.duration_ms = None;
    }
    assert_eq!(items[1..], expected[..], "记录器状态与逐条消费不一致");
    assert_eq!(items[1].reasoning.as_deref(), Some("想"));

    std::fs::remove_dir_all(&dir).ok();
}

/// 中途草稿会被终态条目替换 (不重复追加)。
#[tokio::test]
async fn periodic_draft_is_replaced_by_final_item() {
    let dir = temp_dir("draft");
    let (sessions, session_id) = anchored_store(&dir);
    let (frontend, _events) = collector();
    let pipeline = pipeline(
        &sessions,
        &session_id,
        frontend,
        Timing {
            delta: Duration::from_millis(10),
            draft: Duration::from_millis(20),
        },
    );
    let sink = pipeline.sink();

    sink(AiChatEvent::Delta {
        text: "部分".to_string(),
    });
    tokio::time::sleep(Duration::from_millis(300)).await;
    let draft = sessions.get(&session_id).unwrap().items;
    assert_eq!(draft.len(), 2, "中途草稿已落盘: {draft:?}");
    assert_eq!(draft[1].text, "部分");

    sink(AiChatEvent::Delta {
        text: "回答".to_string(),
    });
    sink(AiChatEvent::Done { rounds: 1 });
    pipeline.finish().await;

    let items = sessions.get(&session_id).unwrap().items;
    assert_eq!(items.len(), 2, "终态覆盖草稿: {items:?}");
    assert_eq!(items[1].text, "部分回答");

    std::fs::remove_dir_all(&dir).ok();
}

/// 取消的回合保留部分回答, 且只落一条。
#[tokio::test]
async fn cancelled_turn_keeps_partial_once() {
    let dir = temp_dir("cancelled");
    let (sessions, session_id) = anchored_store(&dir);
    let (frontend, events) = collector();
    let pipeline = pipeline(&sessions, &session_id, frontend, Timing::default());
    let sink = pipeline.sink();

    sink(AiChatEvent::Delta {
        text: "半".to_string(),
    });
    sink(AiChatEvent::Cancelled);
    pipeline.finish().await;

    let seen = events.lock().clone();
    assert!(matches!(seen.last(), Some(AiChatEvent::Cancelled)));
    let items = sessions.get(&session_id).unwrap().items;
    assert_eq!(items.len(), 2);
    assert_eq!(items[1].text, "半");

    std::fs::remove_dir_all(&dir).ok();
}

/// 空回合不产生助手条目。
#[tokio::test]
async fn empty_turn_persists_nothing() {
    let dir = temp_dir("empty");
    let (sessions, session_id) = anchored_store(&dir);
    let (frontend, _events) = collector();
    let pipeline = pipeline(&sessions, &session_id, frontend, Timing::default());
    let sink = pipeline.sink();

    sink(AiChatEvent::Done { rounds: 1 });
    pipeline.finish().await;

    assert_eq!(sessions.get(&session_id).unwrap().items.len(), 1);

    std::fs::remove_dir_all(&dir).ok();
}

/// 没有用户锚点时不写中途草稿 (终态追加一次, 不重复)。
#[tokio::test]
async fn unanchored_turn_skips_periodic_drafts() {
    let dir = temp_dir("unanchored");
    let sessions = Arc::new(SessionStore::empty(&dir));
    let session = sessions.create("会话").expect("新建会话");
    let (frontend, _events) = collector();
    let pipeline = TurnPipeline::spawn_with(
        frontend,
        TurnPersistence {
            sessions: Arc::clone(&sessions),
            session_id: session.id.clone(),
            periodic_drafts: false,
        },
        Timing {
            delta: Duration::from_millis(10),
            draft: Duration::from_millis(20),
        },
    );
    let sink = pipeline.sink();

    sink(AiChatEvent::Delta {
        text: "独答".to_string(),
    });
    tokio::time::sleep(Duration::from_millis(120)).await;
    assert!(
        sessions.get(&session.id).unwrap().items.is_empty(),
        "无锚点不写草稿"
    );

    sink(AiChatEvent::Done { rounds: 1 });
    pipeline.finish().await;
    let items = sessions.get(&session.id).unwrap().items;
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].text, "独答");

    std::fs::remove_dir_all(&dir).ok();
}
