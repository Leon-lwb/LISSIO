//! Transport backend extension contracts.
//!
//! The orchestration layer owns these contracts while hardware/network crates
//! implement them.  A backend turns one persisted [`TransportConfig`] into the
//! same byte-oriented connection regardless of the concrete device.

use async_trait::async_trait;
use data_model::{Result, TransportConfig};
use flow::{Boundary, BytesChunk, Direction, FlowEnvelope, FlowGap, Framing, LostUnit, SourceId};
use schema_types::TestDataLink;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::{broadcast, mpsc};

/// Runtime controls that are independent from the concrete transport.
pub trait ConnectionControl: Send + Sync {
    /// Stop background I/O and release the device.
    fn close(&self);

    /// Apply an optional runtime link update.
    ///
    /// Backends that support the update return the effective persisted config;
    /// other backends return `None` without treating it as an error.
    fn update_link(
        &self,
        _link: TestDataLink,
        _config: Option<data_model::TestDataConfig>,
    ) -> Result<Option<TransportConfig>> {
        Ok(None)
    }
}

/// 广播通道上的单条字节消息 — 携带方向, 使发送回环与设备接收可区分
///
/// 读任务按它决定 raw 收集方向与 rx 统计归属; 回环字节 (Transmit) 仍参与
/// transport→transport 路由, 但不再被当作设备接收重复收集。
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ByteMessage {
    pub bytes: Vec<u8>,
    pub direction: Direction,
    pub observed_time_unix_ns: i64,
}

impl ByteMessage {
    /// 设备/网络实际收到的字节 (后端读任务发布)
    pub fn from_device(bytes: Vec<u8>) -> Self {
        Self {
            bytes,
            direction: Direction::Receive,
            observed_time_unix_ns: now_unix_ns(),
        }
    }

    /// 本地写入的回环字节 (`TransportHandle::send` 发布)
    pub fn loopback(bytes: Vec<u8>) -> Self {
        Self {
            bytes,
            direction: Direction::Transmit,
            observed_time_unix_ns: now_unix_ns(),
        }
    }
}

/// A live, byte-oriented connection produced by every backend.
pub struct TransportConnection {
    pub write_tx: mpsc::Sender<Vec<u8>>,
    pub data_tx: broadcast::Sender<ByteMessage>,
    pub control: Arc<dyn ConnectionControl>,
}

impl TransportConnection {
    pub fn new(
        write_tx: mpsc::Sender<Vec<u8>>,
        data_tx: broadcast::Sender<ByteMessage>,
        control: Arc<dyn ConnectionControl>,
    ) -> Self {
        Self {
            write_tx,
            data_tx,
            control,
        }
    }

    /// Adapt the common cancellation-flag runtime used by byte transports.
    pub fn from_cancel_flag(
        write_tx: mpsc::Sender<Vec<u8>>,
        data_tx: broadcast::Sender<ByteMessage>,
        cancel: Arc<AtomicBool>,
    ) -> Self {
        Self::new(write_tx, data_tx, Arc::new(CancelFlag(cancel)))
    }
}

/// Compatibility adapter from the legacy broadcast byte channel to the typed
/// flow plane. Sequence gaps represent lost broadcast messages, never invented
/// byte counts.
pub struct LegacyFlowReceiver {
    source_id: SourceId,
    connection_epoch: u64,
    framing: Framing,
    next_sequence: u64,
    pending_gap: Option<FlowGap>,
    rx: broadcast::Receiver<ByteMessage>,
}

#[cfg(test)]
mod typed_flow_tests {
    use super::*;

    #[tokio::test]
    async fn typed_broadcast_lag_becomes_a_parser_visible_gap() {
        let (tx, rx) = broadcast::channel(1);
        let mut receiver = FlowReceiver::from_typed(rx);
        let source_id = SourceId::new("source").unwrap();
        for sequence in 0..3 {
            tx.send(FlowEnvelope {
                source_id: source_id.clone(),
                connection_epoch: 1,
                first_sequence: sequence,
                last_sequence: sequence,
                observed_time_unix_ns: 0,
                direction: Direction::Receive,
                gap_before: None,
                payload: BytesChunk::complete(
                    vec![u8::try_from(sequence).unwrap()],
                    Framing::Stream,
                ),
            })
            .unwrap();
        }
        let envelope = receiver.recv().await.unwrap();
        let gap = envelope.gap_before.unwrap();
        assert_eq!(gap.first_missing_sequence, 0);
        assert_eq!(gap.last_missing_sequence, 1);
        assert_eq!(gap.lost_units, Some(2));
        assert_eq!(envelope.payload.bytes.as_ref(), &[2]);
    }
}

/// 数据面统一的 typed 字节流接收器。
///
/// 旧传输广播和设备树 typed port 都投影为同一种 `FlowEnvelope` 消费合同；
/// 消费侧不再依赖消息最初来自哪种运行时实现。
pub struct FlowReceiver {
    inner: FlowReceiverInner,
}

enum FlowReceiverInner {
    Legacy(LegacyFlowReceiver),
    Typed(TypedFlowReceiver),
}

struct TypedFlowReceiver {
    rx: broadcast::Receiver<FlowEnvelope<BytesChunk>>,
    pending_lag: u64,
}

impl FlowReceiver {
    /// 包装旧广播适配接收器。
    pub const fn from_legacy(receiver: LegacyFlowReceiver) -> Self {
        Self {
            inner: FlowReceiverInner::Legacy(receiver),
        }
    }

    /// 包装设备树 typed port 接收器。
    pub const fn from_typed(receiver: broadcast::Receiver<FlowEnvelope<BytesChunk>>) -> Self {
        Self {
            inner: FlowReceiverInner::Typed(TypedFlowReceiver {
                rx: receiver,
                pending_lag: 0,
            }),
        }
    }

    /// 接收下一条 typed payload。
    pub async fn recv(&mut self) -> std::result::Result<FlowEnvelope<BytesChunk>, FlowRecvError> {
        match &mut self.inner {
            FlowReceiverInner::Legacy(receiver) => receiver.recv().await,
            FlowReceiverInner::Typed(receiver) => receiver.recv().await,
        }
    }

    /// 非阻塞接收下一条 typed payload。
    pub fn try_recv(&mut self) -> std::result::Result<FlowEnvelope<BytesChunk>, FlowTryRecvError> {
        match &mut self.inner {
            FlowReceiverInner::Legacy(receiver) => receiver.try_recv(),
            FlowReceiverInner::Typed(receiver) => receiver.try_recv(),
        }
    }

    /// 当前排队消息数。
    pub fn len(&self) -> usize {
        match &self.inner {
            FlowReceiverInner::Legacy(receiver) => receiver.len(),
            FlowReceiverInner::Typed(receiver) => receiver.rx.len(),
        }
    }

    /// 当前是否无排队消息。
    pub fn is_empty(&self) -> bool {
        match &self.inner {
            FlowReceiverInner::Legacy(receiver) => receiver.is_empty(),
            FlowReceiverInner::Typed(receiver) => receiver.rx.is_empty(),
        }
    }
}

impl TypedFlowReceiver {
    async fn recv(&mut self) -> std::result::Result<FlowEnvelope<BytesChunk>, FlowRecvError> {
        loop {
            match self.rx.recv().await {
                Ok(envelope) => return Ok(self.with_lag_gap(envelope)),
                Err(broadcast::error::RecvError::Lagged(count)) => {
                    self.pending_lag = self.pending_lag.saturating_add(count);
                }
                Err(broadcast::error::RecvError::Closed) => return Err(FlowRecvError::Closed),
            }
        }
    }

    fn try_recv(&mut self) -> std::result::Result<FlowEnvelope<BytesChunk>, FlowTryRecvError> {
        loop {
            match self.rx.try_recv() {
                Ok(envelope) => return Ok(self.with_lag_gap(envelope)),
                Err(broadcast::error::TryRecvError::Lagged(count)) => {
                    self.pending_lag = self.pending_lag.saturating_add(count);
                }
                Err(broadcast::error::TryRecvError::Empty) => {
                    return Err(FlowTryRecvError::Empty);
                }
                Err(broadcast::error::TryRecvError::Closed) => {
                    return Err(FlowTryRecvError::Closed);
                }
            }
        }
    }

    fn with_lag_gap(&mut self, mut envelope: FlowEnvelope<BytesChunk>) -> FlowEnvelope<BytesChunk> {
        let lost = std::mem::take(&mut self.pending_lag);
        if lost > 0 && envelope.gap_before.is_none() {
            envelope.gap_before = Some(FlowGap {
                first_missing_sequence: envelope.first_sequence.saturating_sub(lost),
                last_missing_sequence: envelope.first_sequence.saturating_sub(1),
                lost_units: Some(lost),
                unit: LostUnit::Messages,
            });
        }
        envelope
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FlowRecvError {
    Closed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FlowTryRecvError {
    Empty,
    Closed,
}

impl LegacyFlowReceiver {
    pub const fn new(
        source_id: SourceId,
        connection_epoch: u64,
        framing: Framing,
        rx: broadcast::Receiver<ByteMessage>,
    ) -> Self {
        Self {
            source_id,
            connection_epoch,
            framing,
            next_sequence: 0,
            pending_gap: None,
            rx,
        }
    }

    pub async fn recv(&mut self) -> std::result::Result<FlowEnvelope<BytesChunk>, FlowRecvError> {
        loop {
            match self.rx.recv().await {
                Ok(message) => return Ok(self.wrap(message)),
                Err(broadcast::error::RecvError::Lagged(count)) => self.note_lag(count),
                Err(broadcast::error::RecvError::Closed) => return Err(FlowRecvError::Closed),
            }
        }
    }

    pub fn try_recv(&mut self) -> std::result::Result<FlowEnvelope<BytesChunk>, FlowTryRecvError> {
        loop {
            match self.rx.try_recv() {
                Ok(message) => return Ok(self.wrap(message)),
                Err(broadcast::error::TryRecvError::Lagged(count)) => self.note_lag(count),
                Err(broadcast::error::TryRecvError::Empty) => return Err(FlowTryRecvError::Empty),
                Err(broadcast::error::TryRecvError::Closed) => {
                    return Err(FlowTryRecvError::Closed);
                }
            }
        }
    }

    pub fn len(&self) -> usize {
        self.rx.len()
    }

    /// Whether any message is already queued in the underlying broadcast slot.
    pub fn is_empty(&self) -> bool {
        self.rx.is_empty()
    }

    const fn note_lag(&mut self, count: u64) {
        let first = self.next_sequence;
        let last = first.saturating_add(count.saturating_sub(1));
        self.next_sequence = self.next_sequence.saturating_add(count);
        self.pending_gap = Some(FlowGap {
            first_missing_sequence: first,
            last_missing_sequence: last,
            lost_units: Some(count),
            unit: LostUnit::Messages,
        });
    }

    fn wrap(&mut self, message: ByteMessage) -> FlowEnvelope<BytesChunk> {
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        FlowEnvelope {
            source_id: self.source_id.clone(),
            connection_epoch: self.connection_epoch,
            first_sequence: sequence,
            last_sequence: sequence,
            observed_time_unix_ns: message.observed_time_unix_ns,
            direction: message.direction,
            gap_before: self.pending_gap.take(),
            payload: BytesChunk {
                bytes: message.bytes.into(),
                framing: self.framing,
                boundary: Boundary::Complete,
            },
        }
    }
}

fn now_unix_ns() -> i64 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    i64::try_from(nanos).unwrap_or(i64::MAX)
}

struct CancelFlag(Arc<AtomicBool>);

impl ConnectionControl for CancelFlag {
    fn close(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
}

/// Factory extension point for serial, network, USB and future transports.
#[async_trait]
pub trait TransportBackend: Send + Sync {
    /// Stable diagnostic name used in errors and logs.
    fn name(&self) -> &'static str;

    fn supports_discovery(&self) -> bool {
        false
    }

    fn discover(&self, _config: &TransportConfig) -> Result<Vec<crate::DiscoveredEndpoint>> {
        Ok(Vec::new())
    }

    /// Whether this backend owns the supplied configuration variant.
    fn accepts(&self, config: &TransportConfig) -> bool;

    /// Open a connection. Called only after [`Self::accepts`] returned true.
    async fn open(
        &self,
        config: TransportConfig,
        link: TestDataLink,
    ) -> Result<TransportConnection>;
}

#[cfg(test)]
mod flow_tests {
    use super::*;

    #[tokio::test]
    async fn compatibility_receiver_preserves_boundary_and_reports_message_gap() {
        let (tx, rx) = broadcast::channel(2);
        let mut flow =
            LegacyFlowReceiver::new(SourceId::new("udp:test").unwrap(), 4, Framing::Datagram, rx);
        tx.send(ByteMessage::from_device(vec![0])).unwrap();
        tx.send(ByteMessage::from_device(vec![1])).unwrap();
        tx.send(ByteMessage::from_device(vec![2])).unwrap();

        let envelope = flow.recv().await.unwrap();
        assert_eq!(envelope.connection_epoch, 4);
        assert_eq!(envelope.first_sequence, 1);
        assert_eq!(envelope.payload.framing, Framing::Datagram);
        let gap = envelope.gap_before.unwrap();
        assert_eq!(
            (gap.first_missing_sequence, gap.last_missing_sequence),
            (0, 0)
        );
        assert_eq!((gap.lost_units, gap.unit), (Some(1), LostUnit::Messages));
    }

    #[tokio::test]
    async fn receiver_maps_message_direction_into_envelope() {
        let (tx, rx) = broadcast::channel(4);
        let mut flow = LegacyFlowReceiver::new(
            SourceId::new("serial:test").unwrap(),
            1,
            Framing::Stream,
            rx,
        );
        tx.send(ByteMessage::from_device(vec![1])).unwrap();
        tx.send(ByteMessage::loopback(vec![2])).unwrap();

        assert_eq!(flow.recv().await.unwrap().direction, Direction::Receive);
        assert_eq!(flow.recv().await.unwrap().direction, Direction::Transmit);
    }
}
