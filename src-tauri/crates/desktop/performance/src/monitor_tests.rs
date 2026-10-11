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
    assert!((snapshot.p50_latency_ms - 2.0).abs() < f64::EPSILON);
    assert!((snapshot.p95_latency_ms - 9.0).abs() < f64::EPSILON);
    assert!((snapshot.max_latency_ms - 9.0).abs() < f64::EPSILON);
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
