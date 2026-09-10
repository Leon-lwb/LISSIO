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

/// A live, byte-oriented connection produced by every backend.
pub struct TransportConnection {
    pub write_tx: mpsc::Sender<Vec<u8>>,
    pub data_tx: broadcast::Sender<Vec<u8>>,
    pub control: Arc<dyn ConnectionControl>,
}

impl TransportConnection {
    pub fn new(
        write_tx: mpsc::Sender<Vec<u8>>,
        data_tx: broadcast::Sender<Vec<u8>>,
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
        data_tx: broadcast::Sender<Vec<u8>>,
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
    rx: broadcast::Receiver<Vec<u8>>,
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
        rx: broadcast::Receiver<Vec<u8>>,
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
                Ok(bytes) => return Ok(self.wrap(bytes)),
                Err(broadcast::error::RecvError::Lagged(count)) => self.note_lag(count),
                Err(broadcast::error::RecvError::Closed) => return Err(FlowRecvError::Closed),
            }
        }
    }

    pub fn try_recv(&mut self) -> std::result::Result<FlowEnvelope<BytesChunk>, FlowTryRecvError> {
        loop {
            match self.rx.try_recv() {
                Ok(bytes) => return Ok(self.wrap(bytes)),
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

    fn wrap(&mut self, bytes: Vec<u8>) -> FlowEnvelope<BytesChunk> {
        let sequence = self.next_sequence;
        self.next_sequence = self.next_sequence.saturating_add(1);
        FlowEnvelope {
            source_id: self.source_id.clone(),
            connection_epoch: self.connection_epoch,
            first_sequence: sequence,
            last_sequence: sequence,
            observed_time_unix_ns: now_unix_ns(),
            direction: Direction::Receive,
            gap_before: self.pending_gap.take(),
            payload: BytesChunk {
                bytes: bytes.into(),
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
        tx.send(vec![0]).unwrap();
        tx.send(vec![1]).unwrap();
        tx.send(vec![2]).unwrap();

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
}
