//! WebSocket 会话 — 事件扇出 / 显示订阅 / 单连接内 RPC。
//!
//! 一条连接承担三件事:
//! 1. 订阅全局事件广播 (`BackendEventSink` 的输出) 并转发给本连接;
//! 2. 承载显示流订阅 — 每订阅一个 [`WsStreamSink`], 取消/断连时逐个注销,
//!    否则 `app::display` 的订阅循环会对已关闭的连接空转;
//! 3. 复用 `rpc-api::dispatch` 执行命令 (与 HTTP-RPC 完全同一条路径)。
//!
//! 订阅 id 由进程级计数器分配: `app::display` 的订阅表是全局的, 多连接共用
//! 同一命名空间, 各连接从 1 开始编号会互相踢掉订阅。

use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use app::display::DisplayRequest;
use axum::extract::ws::{Message, WebSocket};
use backend_host::BackendHost;
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::{broadcast, mpsc};

use crate::frames::{ClientMessage, ServerMessage, encode_binary_frame};
use crate::sink::{OutFrame, WsStreamSink};

/// 会话上下文 — 由 HTTP 层注入。
pub struct SessionContext {
    /// 已装配后端宿主。
    pub host: Arc<BackendHost>,
    /// 全局事件广播发送端。
    pub broadcast: broadcast::Sender<ServerMessage>,
    /// 进程级订阅 id 分配器。
    pub next_subscription_id: Arc<AtomicU32>,
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
    let (mut sink, mut stream) = socket.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<OutFrame>();

    // 写任务 — 唯一持有 sink 的一方 (回执 / 事件 / 二进制流都经此串行化)
    let writer = tokio::spawn(async move {
        while let Some(frame) = out_rx.recv().await {
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
                break;
            }
        }
    });

    // 事件转发任务 — 广播无接收者 / 落后丢帧都不影响本连接语义
    let forwarder = {
        let out_tx = out_tx.clone();
        let mut events = context.broadcast.subscribe();
        tokio::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(message) => {
                        if out_tx.send(OutFrame::Message(message)).is_err() {
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
                handle_text(&context, &out_tx, &mut active, text.as_str()).await;
            }
            Message::Ping(_) => {
                let _ = out_tx.send(OutFrame::Pong);
            }
            Message::Close(_) => break,
            // 出口不接收二进制上行 (命令与订阅都是 JSON 文本)
            Message::Binary(_) | Message::Pong(_) => {}
        }
    }

    // 断连清理: 必须逐条注销, 否则订阅循环继续向已关闭的连接投递
    for id in active {
        if let Err(error) = app::display::unsubscribe_data(&context.host.state, id).await {
            log::warn!("Web 出口订阅 {id} 注销失败: {error}");
        }
    }
    forwarder.abort();
    drop(out_tx);
    let _ = writer.await;
}

/// 处理一条文本帧 (订阅控制 / RPC / 心跳)。
async fn handle_text(
    context: &SessionContext,
    out_tx: &mpsc::UnboundedSender<OutFrame>,
    active: &mut HashSet<u32>,
    text: &str,
) {
    let message = match serde_json::from_str::<ClientMessage>(text) {
        Ok(message) => message,
        Err(error) => {
            send_message(
                out_tx,
                ServerMessage::Fault {
                    message: format!("帧解析失败: {error}"),
                },
            );
            return;
        }
    };
    match message {
        // 心跳: 收到即证明连接存活, 无需协议级回应
        ClientMessage::Ping => {}
        ClientMessage::Unsubscribe { id } => {
            active.remove(&id);
            if let Err(error) = app::display::unsubscribe_data(&context.host.state, id).await {
                log::warn!("Web 出口订阅 {id} 注销失败: {error}");
            }
            send_message(out_tx, ServerMessage::Unsubscribed { id });
        }
        ClientMessage::Subscribe { args } => {
            subscribe(context, out_tx, active, args).await;
        }
        ClientMessage::Rpc { id, cmd, args } => {
            let response = rpc_api::dispatch(&context.host, &cmd, args).await;
            send_message(out_tx, response_message(id, response));
        }
    }
}

/// 建立显示订阅 — id 由服务端分配并先回执, 客户端据此登记分流表。
///
/// 回执与流帧共用同一条出站队列, 因此客户端一定先看到 `Subscribed` 再看到该 id
/// 的流数据, 不需要握手超时或缓存回放。
async fn subscribe(
    context: &SessionContext,
    out_tx: &mpsc::UnboundedSender<OutFrame>,
    active: &mut HashSet<u32>,
    args: serde_json::Value,
) {
    let parsed: SubscribeArgs = match serde_json::from_value(args) {
        Ok(parsed) => parsed,
        Err(error) => {
            send_message(
                out_tx,
                ServerMessage::Fault {
                    message: format!("订阅参数无效: {error}"),
                },
            );
            return;
        }
    };
    let id = context
        .next_subscription_id
        .fetch_add(1, Ordering::Relaxed)
        .wrapping_add(1)
        .max(1);
    active.insert(id);
    send_message(out_tx, ServerMessage::Subscribed { id });

    let sink = Arc::new(WsStreamSink::new(id, out_tx.clone()));
    if let Err(error) = app::display::subscribe_data(
        &context.host.state,
        parsed.request,
        sink,
        parsed.interval_ms,
        parsed.max_items,
    )
    .await
    {
        // 连接仍在, 但该 id 不会产出数据 — 显式撤销登记, 避免断连时重复注销
        active.remove(&id);
        send_message(
            out_tx,
            ServerMessage::Fault {
                message: format!("订阅失败 (id={id}): {error}"),
            },
        );
    }
}

/// 发送一条结构化消息 (队列已关闭 = 连接正在退出, 静默忽略)。
fn send_message(out_tx: &mpsc::UnboundedSender<OutFrame>, message: ServerMessage) {
    let _ = out_tx.send(OutFrame::Message(message));
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
