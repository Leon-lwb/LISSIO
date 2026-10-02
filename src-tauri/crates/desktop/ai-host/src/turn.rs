//! 回合事件汇聚 — 增量合并、流式中途落盘与终态收束。
//!
//! 记录器与前端推送都在汇聚任务里按序消费事件: 事件回调只做无界入队, 因此
//! LLM 流式热路径既不会被磁盘写入拖住, 也不会被慢渲染器反压。连续同类增量在
//! 一个时间窗口内合并成一条事件后再推送 (记录器消费到的文本与逐条消费完全
//! 一致), 工具调用/结果与终态事件会先冲刷待推送增量, 事件顺序严格保持。
//!
//! 落盘走 [`SessionStore::upsert_turn_items`]: 回合进行中约每 2 秒写一次草稿,
//! 回合收束时再写终态 — 渲染进程被杀也只会丢最后两秒的增量, 而不是整个回答;
//! 终态写入替换草稿, 不会产生重复条目。

use std::sync::Arc;
use std::time::{Duration, Instant};

use chat::{AiChatEvent, EventSink, TurnRecorder};
use chat_session::SessionStore;
use tokio::sync::mpsc;

/// 默认增量合并窗口 — 窗口内到达的同类增量合并为一次前端推送。
const DELTA_WINDOW: Duration = Duration::from_millis(50);
/// 默认中途落盘间隔 — 流式中断最多丢这一段增量。
const DRAFT_INTERVAL: Duration = Duration::from_secs(2);

/// 汇聚节奏 (测试可缩短窗口与落盘间隔)。
pub struct Timing {
    /// 连续增量合并窗口。
    pub delta: Duration,
    /// 流式中途落盘间隔。
    pub draft: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            delta: DELTA_WINDOW,
            draft: DRAFT_INTERVAL,
        }
    }
}

/// 回合收束落盘目标。
pub struct TurnPersistence {
    /// 会话存储。
    pub sessions: Arc<SessionStore>,
    /// 目标会话 id。
    pub session_id: String,
    /// 会话已有用户条目锚点 — 只有此时中途落盘才会替换草稿而不重复追加。
    pub periodic_drafts: bool,
}

/// 回合汇聚句柄 — 事件经 [`TurnPipeline::sink`] 入队, 结束后 [`TurnPipeline::finish`]
/// 等待收束落盘完成。
pub struct TurnPipeline {
    sink: EventSink,
    tx: mpsc::UnboundedSender<TurnMessage>,
    task: tokio::task::JoinHandle<()>,
}

/// 汇聚队列消息 — 显式收束信号保证「事件全部消费完再落盘」。
enum TurnMessage {
    /// 一条对话事件。
    Event(AiChatEvent),
    /// 回合已结束 (无论正常 / 取消 / 错误)。
    End,
}

impl TurnPipeline {
    /// 启动汇聚任务 (默认节奏)。
    pub fn spawn(frontend: EventSink, persistence: TurnPersistence) -> Self {
        Self::spawn_with(frontend, persistence, Timing::default())
    }

    /// 启动汇聚任务 (显式节奏)。
    pub fn spawn_with(frontend: EventSink, persistence: TurnPersistence, timing: Timing) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<TurnMessage>();
        let producer = tx.clone();
        let sink: EventSink = Arc::new(move |event| {
            // 无界队列: 热路径不阻塞; 队列是 FIFO, 顺序由消费端保证
            let _ = producer.send(TurnMessage::Event(event));
        });

        let task = tokio::spawn(async move {
            let mut recorder = TurnRecorder::new();
            let mut pending: Vec<AiChatEvent> = Vec::new();
            let mut ticker = tokio::time::interval(timing.delta);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            let mut last_draft = Instant::now();
            let mut dirty = false;
            loop {
                tokio::select! {
                    message = rx.recv() => {
                        match message {
                            Some(TurnMessage::Event(event)) => {
                                dirty = true;
                                if is_text_delta(&event) {
                                    coalesce(&mut pending, event);
                                } else {
                                    // 工具事件必须先冲刷待推送文本, 顺序才不乱
                                    forward(&mut pending, &mut recorder, &frontend);
                                    recorder.record(&event);
                                    frontend(event);
                                }
                            }
                            // 显式收束或生产端消失都按终态处理
                            Some(TurnMessage::End) | None => {
                                forward(&mut pending, &mut recorder, &frontend);
                                break;
                            }
                        }
                    }
                    _ = ticker.tick() => {
                        forward(&mut pending, &mut recorder, &frontend);
                    }
                }
                // 只在有新内容时写草稿 — 长时间工具执行不反复重写同一份快照
                if persistence.periodic_drafts && dirty && last_draft.elapsed() >= timing.draft {
                    last_draft = Instant::now();
                    dirty = false;
                    persist_draft(&recorder, &persistence);
                }
            }
            // 终态: 完整回合一并落盘, upsert 覆盖中途草稿
            persist_draft(&recorder, &persistence);
        });

        Self { sink, tx, task }
    }

    /// 事件出口 — 交给 `run_chat` 的回调。
    pub fn sink(&self) -> EventSink {
        Arc::clone(&self.sink)
    }

    /// 回合结束: 入队收束信号并等待落盘, 保证所有事件先被消费。
    pub async fn finish(self) {
        let _ = self.tx.send(TurnMessage::End);
        if self.task.await.is_err() {
            log::warn!("AI 会话回合汇聚任务异常结束");
        }
    }
}

/// 是否为可合并的文本类增量。
const fn is_text_delta(event: &AiChatEvent) -> bool {
    matches!(
        event,
        AiChatEvent::Delta { .. } | AiChatEvent::ReasoningDelta { .. }
    )
}

/// 与队尾同类增量合并 — 记录器消费到的文本与逐条消费完全一致。
fn coalesce(pending: &mut Vec<AiChatEvent>, event: AiChatEvent) {
    match (pending.last_mut(), &event) {
        (Some(AiChatEvent::Delta { text: previous }), AiChatEvent::Delta { text }) => {
            previous.push_str(text);
        }
        (
            Some(AiChatEvent::ReasoningDelta { text: previous }),
            AiChatEvent::ReasoningDelta { text },
        ) => {
            previous.push_str(text);
        }
        _ => pending.push(event),
    }
}

/// 按到达顺序记录并推送待发事件, 推送后队列清空。
fn forward(pending: &mut Vec<AiChatEvent>, recorder: &mut TurnRecorder, frontend: &EventSink) {
    for event in pending.drain(..) {
        recorder.record(&event);
        frontend(event);
    }
}

/// 把当前回合快照写成会话尾部草稿 (空快照不写, 也不覆盖已有内容)。
///
/// 中途与终态共用: 重复调用只会替换上一次的草稿。
fn persist_draft(recorder: &TurnRecorder, persistence: &TurnPersistence) {
    let items = recorder.finish();
    if items.is_empty() {
        return;
    }
    if let Err(error) = persistence
        .sessions
        .upsert_turn_items(&persistence.session_id, items)
    {
        log::warn!("AI 会话回合落盘失败: {error}");
    }
}

#[cfg(test)]
mod tests {
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
}
