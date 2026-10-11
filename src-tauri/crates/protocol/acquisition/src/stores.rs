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
            if let Some((epoch, _)) = self.latest.get(&sample.key)
                && *epoch > envelope.connection_epoch
            {
                continue;
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
#[path = "stores_tests.rs"]
mod tests;
