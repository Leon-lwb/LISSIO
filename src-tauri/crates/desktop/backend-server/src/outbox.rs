//! 连接级有界出站队列 — 控制帧可靠、显示流可丢弃且按字节限流。
//!
//! `lissio-server` 的 WebSocket writer 可能因前端慢消费短暂阻塞。若显示帧直接进入
//! 无界队列，原始数据等大载荷会在服务端持续累积。这里把两类帧分开：
//! - 控制帧有帧数上限，关键响应可等待队列空间，不会静默丢失；
//! - 显示流同时受帧数与字节预算约束，满载时丢弃新帧并计数，订阅继续运行。

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use parking_lot::Mutex;
use performance::PerformanceMonitor;
use tokio::sync::Notify;

use crate::frames::ServerMessage;

/// 单连接控制帧队列上限。控制帧以回执/响应为主，超过上限说明客户端已长期停滞。
const CONTROL_MAX_FRAMES: usize = 256;
/// 单连接显示流帧数上限。
const STREAM_MAX_FRAMES: usize = 32;
/// 单连接显示流排队字节上限。
const STREAM_MAX_BYTES: usize = 16 * 1024 * 1024;

/// 服务端 → 单条连接的出站帧。
#[derive(Debug, Clone)]
pub enum OutFrame {
    /// 结构化消息 (事件 / 通知 / 回执 / 响应)。
    Message(ServerMessage),
    /// JSON 显示流 — payload 已是序列化好的 `DisplayEvent`, 直接拼装避免二次解析。
    StreamJson { id: u32, json: String },
    /// 二进制显示流 (WWB1 / VNDP / VENV 原样透传)。
    StreamBinary { id: u32, payload: Vec<u8> },
    /// 协议层 pong — 回应客户端心跳, 不经 JSON 编码。
    Pong,
}

impl OutFrame {
    const fn subscription_id(&self) -> Option<u32> {
        match self {
            Self::StreamJson { id, .. } | Self::StreamBinary { id, .. } => Some(*id),
            Self::Message(_) | Self::Pong => None,
        }
    }

    const fn is_stream(&self) -> bool {
        matches!(self, Self::StreamJson { .. } | Self::StreamBinary { .. })
    }

    const fn stream_bytes(&self) -> usize {
        match self {
            Self::StreamJson { json, .. } => json.len(),
            Self::StreamBinary { payload, .. } => payload.len(),
            Self::Message(_) | Self::Pong => 0,
        }
    }
}

/// 队列已关闭 — 发送方应停止订阅或丢弃后续事件。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OutboxClosed;

#[derive(Debug)]
struct OutboxState {
    control: VecDeque<OutFrame>,
    stream: VecDeque<OutFrame>,
    queued_stream_bytes: usize,
    closed: bool,
}

impl OutboxState {
    const fn new() -> Self {
        Self {
            control: VecDeque::new(),
            stream: VecDeque::new(),
            queued_stream_bytes: 0,
            closed: false,
        }
    }
}

/// 出站队列水位与丢弃统计。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OutboxStats {
    /// 当前排队控制帧数。
    pub queued_control_frames: usize,
    /// 当前排队显示帧数。
    pub queued_stream_frames: usize,
    /// 当前排队显示帧字节数。
    pub queued_stream_bytes: usize,
    /// 因控制队列满而丢弃的事件帧数。
    pub dropped_control_frames: u64,
    /// 因显示流预算满或单帧超限而丢弃的帧数。
    pub dropped_stream_frames: u64,
    /// 被丢弃显示帧的载荷字节数。
    pub dropped_stream_bytes: u64,
}

/// 一条 WebSocket 连接的双队列出站端口。
pub struct ConnectionOutbox {
    state: Mutex<OutboxState>,
    ready: Notify,
    dropped_control_frames: AtomicU64,
    dropped_stream_frames: AtomicU64,
    dropped_stream_bytes: AtomicU64,
    monitor: Option<Arc<PerformanceMonitor>>,
}

impl ConnectionOutbox {
    /// 构造空队列。
    pub fn new() -> Self {
        Self::with_monitor(None)
    }

    /// Construct a queue wired into the backend performance monitor.
    pub fn with_monitor(monitor: Option<Arc<PerformanceMonitor>>) -> Self {
        Self {
            state: Mutex::new(OutboxState::new()),
            ready: Notify::new(),
            dropped_control_frames: AtomicU64::new(0),
            dropped_stream_frames: AtomicU64::new(0),
            dropped_stream_bytes: AtomicU64::new(0),
            monitor,
        }
    }

    /// 关键控制帧入队；队列满时等待空间，连接关闭时返回 [`OutboxClosed`]。
    pub(crate) async fn send_control(&self, frame: OutFrame) -> Result<(), OutboxClosed> {
        let mut pending = Some(frame);
        loop {
            let ready = self.ready.notified();
            tokio::pin!(ready);
            ready.as_mut().enable();
            {
                let mut state = self.state.lock();
                if state.closed {
                    return Err(OutboxClosed);
                }
                if state.control.len() < CONTROL_MAX_FRAMES {
                    let Some(frame) = pending.take() else {
                        return Err(OutboxClosed);
                    };
                    state.control.push_back(frame);
                    drop(state);
                    self.ready.notify_waiters();
                    return Ok(());
                }
            }
            ready.await;
        }
    }

    /// 非关键控制帧入队；队列满时丢弃，连接关闭时返回 `false`。
    pub(crate) fn try_send_control_lossy(&self, frame: OutFrame) -> bool {
        let mut state = self.state.lock();
        if state.closed {
            return false;
        }
        if state.control.len() >= CONTROL_MAX_FRAMES {
            drop(state);
            self.record_control_drop();
            return true;
        }
        state.control.push_back(frame);
        drop(state);
        self.ready.notify_waiters();
        true
    }

    /// 显示流入队；队列满时丢弃新帧，只有连接关闭才返回 `false`。
    pub(crate) fn try_send_stream_lossy(&self, frame: OutFrame) -> bool {
        let bytes = frame.stream_bytes();
        let mut state = self.state.lock();
        if state.closed {
            return false;
        }
        if bytes > STREAM_MAX_BYTES
            || state.stream.len() >= STREAM_MAX_FRAMES
            || state.queued_stream_bytes.saturating_add(bytes) > STREAM_MAX_BYTES
        {
            drop(state);
            self.record_stream_drop(bytes);
            return true;
        }
        state.queued_stream_bytes = state.queued_stream_bytes.saturating_add(bytes);
        state.stream.push_back(frame);
        drop(state);
        self.ready.notify_waiters();
        true
    }

    /// writer 取下一帧；控制帧严格优先，队列关闭且排空后返回 `None`。
    pub(crate) async fn recv(&self) -> Option<OutFrame> {
        loop {
            let ready = self.ready.notified();
            tokio::pin!(ready);
            ready.as_mut().enable();
            {
                let mut state = self.state.lock();
                if let Some(frame) = state.control.pop_front() {
                    drop(state);
                    self.ready.notify_waiters();
                    return Some(frame);
                }
                if let Some(frame) = state.stream.pop_front() {
                    state.queued_stream_bytes = state
                        .queued_stream_bytes
                        .saturating_sub(frame.stream_bytes());
                    if frame.is_stream() {
                        self.record_stream_sent(frame.stream_bytes());
                    }
                    drop(state);
                    self.ready.notify_waiters();
                    return Some(frame);
                }
                if state.closed {
                    return None;
                }
            }
            ready.await;
        }
    }

    /// 移除指定订阅尚未写出的显示帧。
    pub(crate) fn remove_subscription(&self, subscription_id: u32) {
        let mut state = self.state.lock();
        state
            .stream
            .retain(|frame| frame.subscription_id() != Some(subscription_id));
        state.queued_stream_bytes = state.stream.iter().fold(0_usize, |total, frame| {
            total.saturating_add(frame.stream_bytes())
        });
        drop(state);
        self.ready.notify_waiters();
    }

    /// 关闭队列并立即释放所有待发帧。
    pub(crate) fn close(&self) {
        let mut state = self.state.lock();
        if state.closed {
            return;
        }
        state.closed = true;
        state.control.clear();
        state.stream.clear();
        state.queued_stream_bytes = 0;
        drop(state);
        self.ready.notify_waiters();
    }

    /// 读取当前水位与累计丢弃量。
    pub fn stats(&self) -> OutboxStats {
        let state = self.state.lock();
        OutboxStats {
            queued_control_frames: state.control.len(),
            queued_stream_frames: state.stream.len(),
            queued_stream_bytes: state.queued_stream_bytes,
            dropped_control_frames: self.dropped_control_frames.load(Ordering::Relaxed),
            dropped_stream_frames: self.dropped_stream_frames.load(Ordering::Relaxed),
            dropped_stream_bytes: self.dropped_stream_bytes.load(Ordering::Relaxed),
        }
    }

    fn record_control_drop(&self) {
        let dropped = self.dropped_control_frames.fetch_add(1, Ordering::Relaxed) + 1;
        if dropped == 1 || dropped.is_power_of_two() {
            log::warn!("WebSocket 控制队列已满，累计丢弃 {dropped} 条非关键事件");
        }
    }

    fn record_stream_sent(&self, bytes: usize) {
        if let Some(monitor) = self.monitor.as_ref() {
            monitor.record_ws_sent(bytes);
        }
    }

    fn record_stream_drop(&self, bytes: usize) {
        let dropped = self.dropped_stream_frames.fetch_add(1, Ordering::Relaxed) + 1;
        self.dropped_stream_bytes
            .fetch_add(u64::try_from(bytes).unwrap_or(u64::MAX), Ordering::Relaxed);
        if let Some(monitor) = self.monitor.as_ref() {
            monitor.record_ws_drop(bytes);
        }
        if dropped == 1 || dropped.is_power_of_two() {
            log::warn!("WebSocket 显示流超出 32 帧 / 16 MiB 预算，累计丢弃 {dropped} 帧");
        }
    }
}

impl Default for ConnectionOutbox {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn stream(id: u32, bytes: usize) -> OutFrame {
        OutFrame::StreamBinary {
            id,
            payload: vec![0_u8; bytes],
        }
    }

    #[tokio::test]
    async fn stream_queue_is_bounded_by_frames_and_bytes() {
        let outbox = ConnectionOutbox::new();
        for _ in 0..100 {
            assert!(outbox.try_send_stream_lossy(stream(7, 1024 * 1024)));
        }

        let stats = outbox.stats();
        assert!(stats.queued_stream_frames <= STREAM_MAX_FRAMES);
        assert!(stats.queued_stream_bytes <= STREAM_MAX_BYTES);
        assert!(stats.dropped_stream_frames > 0);
        assert!(stats.dropped_stream_bytes > 0);
    }

    #[tokio::test]
    async fn oversized_stream_frame_is_dropped_without_terminating_subscription() {
        let outbox = ConnectionOutbox::new();
        assert!(outbox.try_send_stream_lossy(stream(7, STREAM_MAX_BYTES + 1)));
        let stats = outbox.stats();
        assert_eq!(stats.queued_stream_frames, 0);
        assert_eq!(stats.dropped_stream_frames, 1);
    }

    #[tokio::test]
    async fn remove_subscription_purges_only_that_subscriptions_frames() {
        let outbox = ConnectionOutbox::new();
        assert!(outbox.try_send_stream_lossy(stream(1, 32)));
        assert!(outbox.try_send_stream_lossy(stream(2, 64)));

        outbox.remove_subscription(1);
        let Some(OutFrame::StreamBinary { id, .. }) = outbox.recv().await else {
            panic!("应保留订阅 2 的帧");
        };
        assert_eq!(id, 2);
    }

    #[tokio::test]
    async fn critical_control_send_waits_for_space_without_data_loss() {
        let outbox = Arc::new(ConnectionOutbox::new());
        for _ in 0..CONTROL_MAX_FRAMES {
            assert!(outbox.try_send_control_lossy(OutFrame::Pong));
        }

        let waiting_outbox = outbox.clone();
        let mut waiting = tokio::spawn(async move {
            waiting_outbox
                .send_control(OutFrame::Message(ServerMessage::Unsubscribed { id: 9 }))
                .await
        });
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut waiting)
                .await
                .is_err()
        );

        assert!(outbox.recv().await.is_some());
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(100), waiting)
                .await
                .expect("释放空间后控制帧应入队")
                .is_ok()
        );
    }

    #[tokio::test]
    async fn close_releases_pending_frames_and_stops_senders() {
        let outbox = ConnectionOutbox::new();
        assert!(outbox.try_send_stream_lossy(stream(7, 128)));
        outbox.close();

        let stats = outbox.stats();
        assert_eq!(stats.queued_stream_frames, 0);
        assert_eq!(stats.queued_stream_bytes, 0);
        assert!(!outbox.try_send_stream_lossy(stream(7, 128)));
        assert!(outbox.recv().await.is_none());
    }
}
