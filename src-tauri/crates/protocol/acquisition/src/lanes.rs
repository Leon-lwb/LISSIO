use flow::{FlowGap, LostUnit};
use points::{PointEnvelope, PointKey, PointValue};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::{Mutex, mpsc};

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum LaneError {
    #[error("lane is full")]
    Full,
    #[error("lane is closed")]
    Closed,
    #[error("item exceeds lane byte budget")]
    Oversized,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct StateLaneStats {
    pub overwritten: u64,
    pub evicted: u64,
    pub estimated_bytes: usize,
}

struct StateInner {
    latest: HashMap<PointKey, points::PointSample>,
    order: VecDeque<PointKey>,
    stats: StateLaneStats,
}

/// Latest-value lane bounded by both point count and estimated heap bytes.
pub struct StateLane {
    max_points: usize,
    max_bytes: usize,
    inner: parking_lot::Mutex<StateInner>,
}

impl StateLane {
    pub fn new(max_points: usize, max_bytes: usize) -> Self {
        Self {
            max_points,
            max_bytes,
            inner: parking_lot::Mutex::new(StateInner {
                latest: HashMap::new(),
                order: VecDeque::new(),
                stats: StateLaneStats::default(),
            }),
        }
    }

    pub fn push(&self, sample: points::PointSample) -> Result<(), LaneError> {
        let size = estimate_sample(&sample);
        if size > self.max_bytes || self.max_points == 0 {
            return Err(LaneError::Oversized);
        }
        let mut inner = self.inner.lock();
        if let Some(old) = inner.latest.remove(&sample.key) {
            inner.stats.estimated_bytes = inner
                .stats
                .estimated_bytes
                .saturating_sub(estimate_sample(&old));
            inner.order.retain(|key| key != &sample.key);
            inner.stats.overwritten = inner.stats.overwritten.saturating_add(1);
        }
        while inner.latest.len() >= self.max_points
            || inner.stats.estimated_bytes.saturating_add(size) > self.max_bytes
        {
            let Some(oldest) = inner.order.pop_front() else {
                break;
            };
            if let Some(old) = inner.latest.remove(&oldest) {
                inner.stats.estimated_bytes = inner
                    .stats
                    .estimated_bytes
                    .saturating_sub(estimate_sample(&old));
                inner.stats.evicted = inner.stats.evicted.saturating_add(1);
            }
        }
        inner.stats.estimated_bytes = inner.stats.estimated_bytes.saturating_add(size);
        inner.order.push_back(sample.key.clone());
        inner.latest.insert(sample.key.clone(), sample);
        Ok(())
    }

    pub fn snapshot(&self) -> Vec<points::PointSample> {
        let inner = self.inner.lock();
        inner
            .order
            .iter()
            .filter_map(|key| inner.latest.get(key).cloned())
            .collect()
    }

    pub fn stats(&self) -> StateLaneStats {
        self.inner.lock().stats
    }
}

fn estimate_sample(sample: &points::PointSample) -> usize {
    sample.key.source_id.as_str().len()
        + sample.key.point_id.0.len()
        + sample.value.as_ref().map_or(0, estimate_value)
        + sample.quality.native.as_ref().map_or(0, |native| {
            native.domain.len() + native.code.len() + native.detail.as_ref().map_or(0, String::len)
        })
        + 96
}

fn estimate_value(value: &PointValue) -> usize {
    match value {
        PointValue::Null => 0,
        PointValue::Bool(_) => 1,
        PointValue::I64(_) | PointValue::U64(_) | PointValue::F64(_) | PointValue::DateTime(_) => 8,
        PointValue::Decimal(value) | PointValue::String(value) => value.len(),
        PointValue::Bytes(value) => value.len(),
        PointValue::Enum { label, .. } => 8 + label.as_ref().map_or(0, String::len),
        PointValue::Array(values) => values.iter().map(estimate_value).sum(),
        PointValue::Struct(fields) => fields
            .iter()
            .map(|field| field.name.len() + estimate_value(&field.value))
            .sum(),
    }
}

struct EventSender {
    tx: mpsc::Sender<PointEnvelope>,
    dropped_first: AtomicU64,
    dropped_last: AtomicU64,
}

#[derive(Clone)]
pub struct EventLane {
    inner: Arc<EventSender>,
}

pub struct EventLaneReceiver {
    rx: mpsc::Receiver<PointEnvelope>,
}

impl EventLane {
    pub fn channel(capacity: usize) -> (Self, EventLaneReceiver) {
        let (tx, rx) = mpsc::channel(capacity);
        (
            Self {
                inner: Arc::new(EventSender {
                    tx,
                    dropped_first: AtomicU64::new(u64::MAX),
                    dropped_last: AtomicU64::new(0),
                }),
            },
            EventLaneReceiver { rx },
        )
    }

    pub fn try_send(&self, mut envelope: PointEnvelope) -> Result<(), LaneError> {
        let first = self.inner.dropped_first.swap(u64::MAX, Ordering::AcqRel);
        if first != u64::MAX {
            let last = self.inner.dropped_last.swap(0, Ordering::AcqRel);
            envelope.gap_before = Some(FlowGap {
                first_missing_sequence: first,
                last_missing_sequence: last,
                lost_units: Some(last.saturating_sub(first).saturating_add(1)),
                unit: LostUnit::Samples,
            });
        }
        self.inner.tx.try_send(envelope).map_err(|error| {
            let envelope = error.into_inner();
            self.note_drop(envelope.first_sequence, envelope.last_sequence);
            if self.inner.tx.is_closed() {
                LaneError::Closed
            } else {
                LaneError::Full
            }
        })
    }

    fn note_drop(&self, first: u64, last: u64) {
        let _ = self.inner.dropped_first.fetch_min(first, Ordering::AcqRel);
        let _ = self.inner.dropped_last.fetch_max(last, Ordering::AcqRel);
    }
}

impl EventLaneReceiver {
    pub async fn recv(&mut self) -> Option<PointEnvelope> {
        self.rx.recv().await
    }
}

/// Small FIFO for commands. Full queues fail immediately with `Busy` semantics.
#[derive(Clone)]
pub struct CommandLane<T> {
    tx: mpsc::Sender<T>,
    rx: Arc<Mutex<mpsc::Receiver<T>>>,
}

impl<T> CommandLane<T> {
    pub fn new(capacity: usize) -> Self {
        let (tx, rx) = mpsc::channel(capacity);
        Self {
            tx,
            rx: Arc::new(Mutex::new(rx)),
        }
    }

    pub fn try_send(&self, item: T) -> Result<(), LaneError> {
        self.tx.try_send(item).map_err(|error| match error {
            mpsc::error::TrySendError::Closed(_) => LaneError::Closed,
            mpsc::error::TrySendError::Full(_) => LaneError::Full,
        })
    }

    pub async fn recv(&self) -> Option<T> {
        self.rx.lock().await.recv().await
    }
}

#[cfg(test)]
#[path = "lanes_tests.rs"]
mod tests;
