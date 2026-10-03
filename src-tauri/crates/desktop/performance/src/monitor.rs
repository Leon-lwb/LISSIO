//! Bounded backend metric recorder and process sampler.

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

use crate::{
    BackendPerformanceSnapshot, PipelinePerformance, ProcessPerformance, RpcPerformance,
    WebSocketPerformance,
};

const RPC_SAMPLE_CAPACITY: usize = 4096;

#[derive(Debug, Default)]
struct RpcState {
    calls: u64,
    errors: u64,
    samples: VecDeque<u64>,
}

impl RpcState {
    fn record(&mut self, latency_us: u64, ok: bool) {
        self.calls = self.calls.saturating_add(1);
        if !ok {
            self.errors = self.errors.saturating_add(1);
        }
        if self.samples.len() == RPC_SAMPLE_CAPACITY {
            self.samples.pop_front();
        }
        self.samples.push_back(latency_us);
    }

    fn snapshot(&self) -> RpcPerformance {
        if self.samples.is_empty() {
            return RpcPerformance {
                calls: self.calls,
                errors: self.errors,
                ..RpcPerformance::default()
            };
        }
        let mut sorted = self.samples.iter().copied().collect::<Vec<_>>();
        sorted.sort_unstable();
        let total = sorted.iter().copied().map(u128::from).sum::<u128>();
        RpcPerformance {
            calls: self.calls,
            errors: self.errors,
            average_latency_ms: micros_to_ms(
                u64::try_from(total / sorted.len() as u128).unwrap_or(u64::MAX),
            ),
            p50_latency_ms: micros_to_ms(percentile(&sorted, 50)),
            p95_latency_ms: micros_to_ms(percentile(&sorted, 95)),
            max_latency_ms: micros_to_ms(sorted[sorted.len() - 1]),
        }
    }
}

#[derive(Debug, Default)]
struct WebSocketState {
    active_connections: AtomicUsize,
    sent_frames: AtomicU64,
    sent_bytes: AtomicU64,
    dropped_frames: AtomicU64,
    dropped_bytes: AtomicU64,
}

impl WebSocketState {
    fn snapshot(&self) -> WebSocketPerformance {
        WebSocketPerformance {
            active_connections: to_u32(self.active_connections.load(Ordering::Relaxed)),
            sent_frames: self.sent_frames.load(Ordering::Relaxed),
            sent_bytes: self.sent_bytes.load(Ordering::Relaxed),
            dropped_frames: self.dropped_frames.load(Ordering::Relaxed),
            dropped_bytes: self.dropped_bytes.load(Ordering::Relaxed),
        }
    }
}

/// Shared backend performance recorder.
pub struct PerformanceMonitor {
    started: Instant,
    pid: Pid,
    system: Mutex<System>,
    rpc: Mutex<RpcState>,
    websocket: WebSocketState,
}

impl PerformanceMonitor {
    /// Create a monitor for the current backend process.
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            started: Instant::now(),
            pid: Pid::from_u32(std::process::id()),
            system: Mutex::new(System::new()),
            rpc: Mutex::new(RpcState::default()),
            websocket: WebSocketState::default(),
        })
    }

    /// Record one command dispatch.
    pub fn record_rpc(&self, latency: std::time::Duration, ok: bool) {
        let latency_us = u64::try_from(latency.as_micros()).unwrap_or(u64::MAX);
        self.rpc.lock().record(latency_us, ok);
    }

    /// Count one successfully written WebSocket stream frame.
    pub fn record_ws_sent(&self, bytes: usize) {
        self.websocket.sent_frames.fetch_add(1, Ordering::Relaxed);
        self.websocket
            .sent_bytes
            .fetch_add(to_u64(bytes), Ordering::Relaxed);
    }

    /// Count one WebSocket stream frame dropped by the bounded outbox.
    pub fn record_ws_drop(&self, bytes: usize) {
        self.websocket
            .dropped_frames
            .fetch_add(1, Ordering::Relaxed);
        self.websocket
            .dropped_bytes
            .fetch_add(to_u64(bytes), Ordering::Relaxed);
    }

    /// Track an open WebSocket connection.
    pub fn ws_connection_opened(&self) {
        self.websocket
            .active_connections
            .fetch_add(1, Ordering::Relaxed);
    }

    /// Track a closed WebSocket connection.
    pub fn ws_connection_closed(&self) {
        self.websocket
            .active_connections
            .fetch_sub(1, Ordering::Relaxed);
    }

    /// Sample current process resources and combine them with runtime counters.
    #[must_use]
    pub fn snapshot(&self, pipeline: PipelinePerformance) -> BackendPerformanceSnapshot {
        let process = self.process_snapshot();
        BackendPerformanceSnapshot {
            sampled_at_ms: unix_time_ms(),
            process,
            rpc: self.rpc.lock().snapshot(),
            websocket: self.websocket.snapshot(),
            pipeline,
        }
    }

    fn process_snapshot(&self) -> ProcessPerformance {
        let mut system = self.system.lock();
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[self.pid]),
            true,
            ProcessRefreshKind::nothing()
                .with_cpu()
                .with_memory()
                .with_tasks(),
        );
        let Some(process) = system.process(self.pid) else {
            return ProcessPerformance {
                cpu_percent: 0.0,
                memory_bytes: 0,
                uptime_ms: self
                    .started
                    .elapsed()
                    .as_millis()
                    .try_into()
                    .unwrap_or(u64::MAX),
                thread_count: 1,
            };
        };
        ProcessPerformance {
            cpu_percent: process.cpu_usage().max(0.0),
            memory_bytes: process.memory(),
            uptime_ms: self
                .started
                .elapsed()
                .as_millis()
                .try_into()
                .unwrap_or(u64::MAX),
            thread_count: process
                .tasks()
                .map_or(1, |tasks| to_u32(tasks.len().max(1))),
        }
    }
}

impl Default for PerformanceMonitor {
    fn default() -> Self {
        Self {
            started: Instant::now(),
            pid: Pid::from_u32(std::process::id()),
            system: Mutex::new(System::new()),
            rpc: Mutex::new(RpcState::default()),
            websocket: WebSocketState::default(),
        }
    }
}

fn percentile(sorted: &[u64], percent: usize) -> u64 {
    let rank = (sorted.len().saturating_mul(percent).div_ceil(100))
        .saturating_sub(1)
        .min(sorted.len() - 1);
    sorted[rank]
}

#[allow(clippy::cast_precision_loss)]
fn micros_to_ms(value: u64) -> f64 {
    value as f64 / 1_000.0
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn to_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

fn to_u64(value: usize) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rpc_snapshot_reports_counts_and_nearest_rank_percentiles() {
        let mut state = RpcState::default();
        state.record(1_000, true);
        state.record(2_000, true);
        state.record(9_000, false);

        let snapshot = state.snapshot();
        assert_eq!(snapshot.calls, 3);
        assert_eq!(snapshot.errors, 1);
        assert_eq!(snapshot.p50_latency_ms, 2.0);
        assert_eq!(snapshot.p95_latency_ms, 9.0);
        assert_eq!(snapshot.max_latency_ms, 9.0);
    }

    #[test]
    fn websocket_counters_track_connections_and_drops() {
        let monitor = PerformanceMonitor::new();
        monitor.ws_connection_opened();
        monitor.record_ws_sent(128);
        monitor.record_ws_drop(64);
        monitor.ws_connection_closed();

        let snapshot = monitor.snapshot(PipelinePerformance::default()).websocket;
        assert_eq!(snapshot.active_connections, 0);
        assert_eq!(snapshot.sent_frames, 1);
        assert_eq!(snapshot.sent_bytes, 128);
        assert_eq!(snapshot.dropped_frames, 1);
        assert_eq!(snapshot.dropped_bytes, 64);
    }
}
