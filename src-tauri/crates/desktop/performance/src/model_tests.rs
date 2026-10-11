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
    assert!((snapshot.queue_wait_max_ms - 2.0).abs() < f64::EPSILON);
    assert!((snapshot.eval_service_max_ms - 4.0).abs() < f64::EPSILON);
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
