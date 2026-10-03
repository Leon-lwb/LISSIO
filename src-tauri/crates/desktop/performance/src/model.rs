//! Backend performance wire contract.

use bus::RuntimeHealth;
use pipeline::data_plane::EvalDiagnostics;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Current process resource usage.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProcessPerformance {
    /// Process CPU usage percent; values may exceed 100 on multi-core hosts.
    pub cpu_percent: f32,
    /// Resident memory in bytes.
    pub memory_bytes: u64,
    /// Process uptime in milliseconds.
    pub uptime_ms: u64,
    /// Process thread/task count where the platform exposes it.
    pub thread_count: u32,
}

/// RPC dispatch latency and traffic.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RpcPerformance {
    pub calls: u64,
    pub errors: u64,
    pub average_latency_ms: f64,
    pub p50_latency_ms: f64,
    pub p95_latency_ms: f64,
    pub max_latency_ms: f64,
}

/// WebSocket output traffic and backpressure drops.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WebSocketPerformance {
    pub active_connections: u32,
    pub sent_frames: u64,
    pub sent_bytes: u64,
    pub dropped_frames: u64,
    pub dropped_bytes: u64,
}

/// Data-plane queue, evaluation, and display-bus health.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PipelinePerformance {
    pub queued_batches: u64,
    pub queued_frames: u64,
    pub queued_bytes: u64,
    pub queue_wait_max_ms: f64,
    pub dispatch_wait_max_ms: f64,
    pub eval_service_max_ms: f64,
    pub completed_frames: u64,
    pub completed_batches: u64,
    pub dropped_frames: u64,
    pub active_topics: u64,
    pub published_samples: u64,
    pub preview_skipped: u64,
    pub ingress_dropped: u64,
}

impl PipelinePerformance {
    /// Project typed data-plane and display-bus diagnostics into the wire shape.
    #[must_use]
    pub fn from_runtime(eval: EvalDiagnostics, health: RuntimeHealth) -> Self {
        Self {
            queued_batches: to_u64(eval.queued_batches),
            queued_frames: to_u64(eval.queued_frames),
            queued_bytes: to_u64(eval.queued_estimated_bytes),
            queue_wait_max_ms: nanos_to_ms(eval.queue_wait_max_ns),
            dispatch_wait_max_ms: nanos_to_ms(eval.dispatch_wait_max_ns),
            eval_service_max_ms: nanos_to_ms(eval.eval_service_max_ns),
            completed_frames: eval.completed_frames,
            completed_batches: eval.completed_batches,
            dropped_frames: eval.dropped_frames,
            active_topics: health.active_topics,
            published_samples: health.published_samples,
            preview_skipped: health.preview_skipped,
            ingress_dropped: health.ingress_dropped,
        }
    }
}

/// One complete backend sample rendered by the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BackendPerformanceSnapshot {
    /// UNIX timestamp in milliseconds.
    pub sampled_at_ms: u64,
    pub process: ProcessPerformance,
    pub rpc: RpcPerformance,
    pub websocket: WebSocketPerformance,
    pub pipeline: PipelinePerformance,
}

fn to_u64(value: usize) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

#[allow(clippy::cast_precision_loss)]
fn nanos_to_ms(value: u64) -> f64 {
    value as f64 / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pipeline_projection_preserves_queue_and_bus_health() {
        let snapshot = PipelinePerformance::from_runtime(
            EvalDiagnostics {
                queued_batches: 2,
                queued_frames: 7,
                queued_estimated_bytes: 4096,
                queue_wait_max_ns: 2_000_000,
                dispatch_wait_max_ns: 3_000_000,
                eval_service_max_ns: 4_000_000,
                completed_frames: 11,
                completed_batches: 5,
                dropped_frames: 1,
            },
            RuntimeHealth {
                active_topics: 3,
                published_samples: 13,
                preview_skipped: 2,
                retention_evicted: 9,
                ingress_dropped: 4,
                last_ack_sequence: 20,
                recommended_interval_ms: 33,
            },
        );

        assert_eq!(snapshot.queued_frames, 7);
        assert_eq!(snapshot.queue_wait_max_ms, 2.0);
        assert_eq!(snapshot.eval_service_max_ms, 4.0);
        assert_eq!(snapshot.published_samples, 13);
        assert_eq!(snapshot.ingress_dropped, 4);
    }

    #[test]
    fn backend_snapshot_uses_camel_case_wire_names() {
        let value = serde_json::to_value(BackendPerformanceSnapshot {
            sampled_at_ms: 10,
            process: ProcessPerformance {
                cpu_percent: 1.5,
                memory_bytes: 2048,
                uptime_ms: 30,
                thread_count: 4,
            },
            rpc: RpcPerformance::default(),
            websocket: WebSocketPerformance::default(),
            pipeline: PipelinePerformance::default(),
        })
        .expect("snapshot serializes");

        assert_eq!(value["sampledAtMs"], 10);
        assert_eq!(value["process"]["memoryBytes"], 2048);
        assert_eq!(value["websocket"]["sentFrames"], 0);
    }
}
