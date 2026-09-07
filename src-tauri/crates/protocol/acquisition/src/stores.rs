use flow::FlowGap;
use points::{PointEnvelope, PointKey, PointSample, WriteResult};
use std::collections::{HashMap, VecDeque};

#[derive(Default)]
pub struct PointStore {
    capacity: usize,
    latest: HashMap<PointKey, (u64, PointSample)>,
    order: VecDeque<PointKey>,
}

impl PointStore {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            ..Self::default()
        }
    }

    pub fn apply(&mut self, envelope: &PointEnvelope) {
        for sample in &envelope.payload.samples {
            if let Some((epoch, _)) = self.latest.get(&sample.key) {
                if *epoch > envelope.connection_epoch {
                    continue;
                }
            }
            self.order.retain(|key| key != &sample.key);
            self.order.push_back(sample.key.clone());
            self.latest.insert(
                sample.key.clone(),
                (envelope.connection_epoch, sample.clone()),
            );
            while self.latest.len() > self.capacity {
                if let Some(oldest) = self.order.pop_front() {
                    self.latest.remove(&oldest);
                }
            }
        }
    }

    pub fn get(&self, key: &PointKey) -> Option<&PointSample> {
        self.latest.get(key).map(|(_, sample)| sample)
    }
}

pub struct EventLog {
    capacity: usize,
    entries: VecDeque<PointEnvelope>,
    pub last_gap: Option<FlowGap>,
}

impl EventLog {
    pub const fn new(capacity: usize) -> Self {
        Self {
            capacity,
            entries: VecDeque::new(),
            last_gap: None,
        }
    }

    pub fn push(&mut self, event: PointEnvelope) {
        if let Some(gap) = &event.gap_before {
            self.last_gap = Some(gap.clone());
        }
        self.entries.push_back(event);
        while self.entries.len() > self.capacity {
            self.entries.pop_front();
        }
    }

    pub const fn entries(&self) -> &VecDeque<PointEnvelope> {
        &self.entries
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CommandStatus {
    Pending,
    Completed(WriteResult),
    TimedOut,
}

pub struct CommandLedger {
    capacity: usize,
    entries: HashMap<String, CommandStatus>,
    order: VecDeque<String>,
}

impl CommandLedger {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity,
            entries: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    pub fn insert(&mut self, correlation_id: String, status: CommandStatus) {
        self.order.retain(|id| id != &correlation_id);
        self.order.push_back(correlation_id.clone());
        self.entries.insert(correlation_id, status);
        while self.entries.len() > self.capacity {
            if let Some(oldest) = self.order.pop_front() {
                self.entries.remove(&oldest);
            }
        }
    }

    pub fn get(&self, correlation_id: &str) -> Option<&CommandStatus> {
        self.entries.get(correlation_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flow::{Direction, FlowEnvelope, SourceId};
    use points::{DeliveryClass, PointBatch, PointId, PointQuality, PointValue};

    fn envelope(epoch: u64, value: u64) -> PointEnvelope {
        let source = SourceId::new("source").unwrap();
        FlowEnvelope {
            source_id: source.clone(),
            connection_epoch: epoch,
            first_sequence: value,
            last_sequence: value,
            observed_time_unix_ns: 0,
            direction: Direction::Receive,
            gap_before: None,
            payload: PointBatch {
                delivery: DeliveryClass::State,
                samples: vec![PointSample {
                    key: PointKey {
                        source_id: source,
                        point_id: PointId("p".into()),
                    },
                    value: Some(PointValue::U64(value)),
                    quality: PointQuality::GOOD,
                    source_time_unix_ns: None,
                    server_time_unix_ns: None,
                    received_time_unix_ns: 0,
                }],
            },
        }
    }

    #[test]
    fn point_store_rejects_old_epoch_callbacks() {
        let mut store = PointStore::new(4);
        store.apply(&envelope(2, 2));
        store.apply(&envelope(1, 1));
        let key = PointKey {
            source_id: SourceId::new("source").unwrap(),
            point_id: PointId("p".into()),
        };
        assert_eq!(store.get(&key).unwrap().value, Some(PointValue::U64(2)));
    }
}
