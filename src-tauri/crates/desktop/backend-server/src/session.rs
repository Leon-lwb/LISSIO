//! WebSocket 会话 — 事件扇出 / 显示订阅 / 单连接内 RPC。
//!
//! 一条连接承担三件事:
//! 1. 订阅全局事件广播 (`BackendEventSink` 的输出) 并转发给本连接;
//! 2. 承载显示流订阅 — 每订阅一个 [`WsStreamSink`], 取消/断连时逐个注销并清理
//!    该订阅尚未写出的帧，否则慢消费者会在服务端形成无界积压;
//! 3. 复用 `rpc-api::dispatch` 执行命令 (与 HTTP-RPC 完全同一条路径)。
//!
//! 订阅 id 由进程级计数器分配: `app::display` 的订阅表是全局的, 多连接共用
//! 同一命名空间, 各连接从 1 开始编号会互相踢掉订阅。

use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};

use app::display::DisplayRequest;
use axum::extract::ws::{Message, WebSocket};
use backend_host::BackendHost;
use futures::{SinkExt, StreamExt};
use performance::PerformanceMonitor;
use serde::Deserialize;
use tokio::sync::broadcast;

use crate::frames::{ClientMessage, ServerMessage, encode_binary_frame};
use crate::outbox::OutboxClosed;
use crate::sink::{ConnectionEventSink, ConnectionOutbox, OutFrame, WsStreamSink};

/// 会话上下文 — 由 HTTP 层注入。
pub struct SessionContext {
    /// 已装配后端宿主。
    pub host: Arc<BackendHost>,
    /// 全局事件广播发送端。
    pub broadcast: broadcast::Sender<ServerMessage>,
    /// 进程级订阅 id 分配器。
    pub next_subscription_id: Arc<AtomicU32>,
    /// 当前活动 WebSocket 连接数。
    pub active_websockets: Arc<AtomicUsize>,
    /// 当前活动显示订阅数。
    pub active_display_subscriptions: Arc<AtomicUsize>,
    /// Backend performance recorder shared by RPC and WebSocket instrumentation.
    pub performance: Arc<PerformanceMonitor>,
}

/// WebSocket 生命周期计数卫兵。
struct ConnectionCountGuard {
    counter: Arc<AtomicUsize>,
    performance: Arc<PerformanceMonitor>,
}

impl ConnectionCountGuard {
    fn new(counter: Arc<AtomicUsize>, performance: Arc<PerformanceMonitor>) -> Self {
        counter.fetch_add(1, Ordering::Relaxed);
        performance.ws_connection_opened();
        Self {
            counter,
            performance,
        }
    }
}

impl Drop for ConnectionCountGuard {
    fn drop(&mut self) {
        self.counter.fetch_sub(1, Ordering::Relaxed);
        self.performance.ws_connection_closed();
    }
}

/// `subscribe_data` 的帧内参数 — 与桌面 IPC 命令参数同形 (顶层 camelCase)。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubscribeArgs {
    request: DisplayRequest,
    interval_ms: Option<u64>,
    max_items: Option<usize>,
}

/// 处理一条已升级的 WebSocket 连接, 直至对端关闭或出错。
pub async fn run(socket: WebSocket, context: SessionContext) {
    let _connection_count = ConnectionCountGuard::new(
        context.active_websockets.clone(),
        context.performance.clone(),
    );
    let (mut sink, mut stream) = socket.split();
    let outbox = Arc::new(ConnectionOutbox::with_monitor(Some(
        context.performance.clone(),
    )));

    // 写任务 — 唯一持有 WebSocket sink 的一方。控制帧严格优先；显示流队列满时
    // 由 ConnectionOutbox 丢弃新帧并计数，不把慢消费者转成服务端内存增长。
    let writer = {
        let outbox = outbox.clone();
        tokio::spawn(async move {
            while let Some(frame) = outbox.recv().await {
                let message = match frame {
                    OutFrame::Message(message) => match serde_json::to_string(&message) {
                        Ok(text) => Message::Text(text.into()),
                        Err(error) => {
                            log::warn!("Web 出口消息序列化失败: {error}");
                            continue;
                        }
                    },
                    OutFrame::StreamJson { id, json } => {
                        Message::Text(stream_json_frame(id, &json).into())
                    }
                    OutFrame::StreamBinary { id, payload } => {
                        Message::Binary(encode_binary_frame(id, &payload).into())
                    }
                    OutFrame::Pong => Message::Pong(Vec::new().into()),
                };
                if sink.send(message).await.is_err() {
                    outbox.close();
                    break;
                }
            }
            let stats = outbox.stats();
            log::debug!(
                "Web writer 已退出: queued_control={}, queued_stream={}, queued_bytes={}, dropped_control={}, dropped_stream={}, dropped_bytes={}",
                stats.queued_control_frames,
                stats.queued_stream_frames,
                stats.queued_stream_bytes,
                stats.dropped_control_frames,
                stats.dropped_stream_frames,
                stats.dropped_stream_bytes
            );
        })
    };

    // 事件转发任务 — 广播无接收者 / 落后丢帧都不影响本连接语义。转发到本连接的
    // 控制队列时允许等待空间，避免无界堆积；广播侧自身已有固定容量。
    let forwarder = {
        let outbox = outbox.clone();
        let mut events = context.broadcast.subscribe();
        tokio::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(message) => {
                        if outbox
                            .send_control(OutFrame::Message(message))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        log::warn!("Web 出口事件推送落后, 丢弃 {skipped} 条");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        })
    };

    let mut active: HashSet<u32> = HashSet::new();
    while let Some(Ok(message)) = stream.next().await {
        match message {
            Message::Text(text) => {
                handle_text(&context, &outbox, &mut active, text.as_str()).await;
                context
                    .active_display_subscriptions
                    .store(active.len(), Ordering::Relaxed);
            }
            Message::Ping(_) => {
                let _ = outbox.send_control(OutFrame::Pong).await;
            }
            Message::Close(_) => break,
            // 出口不接收二进制上行 (命令与订阅都是 JSON 文本)
            Message::Binary(_) | Message::Pong(_) => {}
        }
    }

    // 断连清理: 逐条注销生成任务并清掉尚未写出的订阅帧，再关闭出站队列。
    let active_count = active.len();
    context
        .active_display_subscriptions
        .store(0, Ordering::Relaxed);
    for id in active.drain() {
        outbox.remove_subscription(id);
        if let Err(error) = app::display::unsubscribe_data(&context.host.state, id).await {
            log::warn!("Web 出口订阅 {id} 断连清理失败: {error}");
        }
    }
    log::debug!("WebSocket 断连清理完成: subscriptions={active_count}");
    forwarder.abort();
    outbox.close();
    let _ = writer.await;
}

/// 处理一条客户端文本帧。
async fn handle_text(
    context: &SessionContext,
    outbox: &Arc<ConnectionOutbox>,
    active: &mut HashSet<u32>,
    text: &str,
) {
    let message: ClientMessage = match serde_json::from_str(text) {
        Ok(message) => message,
        Err(error) => {
            let _ =
                send_message(outbox, ServerMessage::fault(format!("帧解析失败: {error}"))).await;
            return;
        }
    };
    match message {
        // 应用层心跳只用于证明连接存活；WebSocket Ping/Pong 由 axum 负责。
        ClientMessage::Ping => {}
        ClientMessage::Unsubscribe { id } => {
            active.remove(&id);
            if let Err(error) = app::display::unsubscribe_data(&context.host.state, id).await {
                log::warn!("Web 出口订阅 {id} 注销失败: {error}");
            }
            outbox.remove_subscription(id);
            log::debug!("Web 显示订阅已取消: id={id}");
            let _ = send_message(outbox, ServerMessage::Unsubscribed { id }).await;
        }
        ClientMessage::Subscribe { args } => {
            subscribe(context, outbox, active, args).await;
        }
        ClientMessage::Rpc { id, cmd, args } => {
            let channel_id = args
                .get("onEvent")
                .or_else(|| args.get("on_event"))
                .and_then(|value| value.get("$channel"))
                .and_then(serde_json::Value::as_u64)
                .and_then(|value| u32::try_from(value).ok());
            let chat_events = channel_id.map(|channel_id| {
                let outbox = outbox.clone();
                std::sync::Arc::new(move |event: chat::AiChatEvent| {
                    if let Ok(payload) = serde_json::to_value(event) {
                        let _ = outbox.try_send_control_lossy(OutFrame::Message(
                            ServerMessage::Channel {
                                id: channel_id,
                                payload,
                            },
                        ));
                    }
                }) as ai_host::ChatEventSink
            });
            let rpc_context = rpc_api::RpcContext {
                chat_events,
                frontend_sink: ConnectionEventSink::handle(outbox),
            };
            let started = std::time::Instant::now();
            let response =
                rpc_api::dispatch_with_context(&context.host, &cmd, args, &rpc_context).await;
            context
                .performance
                .record_rpc(started.elapsed(), response.is_ok());
            let _ = send_message(outbox, response_message(id, response)).await;
        }
    }
}

/// 建立显示订阅 — id 由服务端分配并先回执, 客户端据此登记分流表。
///
/// 回执先于该 id 的任何流帧；后续显示帧进入独立有界队列，慢消费者满载时只丢
/// 预览帧，不影响回执、取消和 RPC 响应。
async fn subscribe(
    context: &SessionContext,
    outbox: &Arc<ConnectionOutbox>,
    active: &mut HashSet<u32>,
    args: serde_json::Value,
) {
    let parsed: SubscribeArgs = match serde_json::from_value(args) {
        Ok(parsed) => parsed,
        Err(error) => {
            let _ = send_message(
                outbox,
                ServerMessage::fault(format!("订阅参数无效: {error}")),
            )
            .await;
            return;
        }
    };
    let id = context
        .next_subscription_id
        .fetch_add(1, Ordering::Relaxed)
        .wrapping_add(1)
        .max(1);
    active.insert(id);
    if send_message(outbox, ServerMessage::Subscribed { id })
        .await
        .is_err()
    {
        active.remove(&id);
        return;
    }

    let sink = Arc::new(WsStreamSink::new(id, outbox.clone()));
    if let Err(error) = app::display::subscribe_data(
        &context.host.state,
        parsed.request,
        sink,
        parsed.interval_ms,
        parsed.max_items,
    )
    .await
    {
        // 连接仍在, 但该 id 不会产出数据 — 显式撤销登记并清掉可能已排队的回放帧。
        active.remove(&id);
        outbox.remove_subscription(id);
        log::warn!("Web 显示订阅建立失败: id={id}, error={error}");
        let _ = send_message(
            outbox,
            ServerMessage::subscription_fault(id, format!("订阅失败: {error}")),
        )
        .await;
        return;
    }
    log::debug!("Web 显示订阅已建立: id={id}");
}

/// 发送一条关键结构化消息；队列满时等待空间，连接关闭时返回错误。
async fn send_message(
    outbox: &ConnectionOutbox,
    message: ServerMessage,
) -> Result<(), OutboxClosed> {
    outbox.send_control(OutFrame::Message(message)).await
}

/// 把 [`rpc_api::RpcError`] 与结果统一成 WS 响应消息。
fn response_message(
    id: serde_json::Value,
    response: Result<serde_json::Value, rpc_api::RpcError>,
) -> ServerMessage {
    match response {
        Ok(result) => ServerMessage::Response {
            id,
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => ServerMessage::Response {
            id,
            ok: false,
            result: None,
            error: serde_json::to_value(error).ok(),
        },
    }
}

/// 拼接 JSON 流帧 — `payload` 已是序列化好的 `DisplayEvent`, 直接内联避免二次解析。
fn stream_json_frame(id: u32, payload: &str) -> String {
    format!("{{\"type\":\"stream\",\"id\":{id},\"payload\":{payload}}}")
}

#[cfg(test)]
mod tests {
    use super::stream_json_frame;

    #[test]
    fn stream_frame_inlines_payload_without_reencoding() {
        let frame = stream_json_frame(4, r#"{"kind":"waveform","payload":{"n":1}}"#);
        assert_eq!(
            frame,
            r#"{"type":"stream","id":4,"payload":{"kind":"waveform","payload":{"n":1}}}"#
        );
    }
}
