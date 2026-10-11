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
#[path = "turn_tests.rs"]
mod tests;
