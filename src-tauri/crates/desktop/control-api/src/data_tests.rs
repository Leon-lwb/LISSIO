use super::{snapshot_fits_memory_budget, snapshot_memory_bytes};
use app::WaveformSnapshot;
use std::collections::HashMap;
use std::sync::Arc;
use waveform::DataBuffer;

#[test]
fn snapshot_memory_limit_accounts_for_all_live_snapshots() {
    let snapshot = |source: &str, estimated_bytes| WaveformSnapshot {
        source: source.into(),
        buffer: Arc::new(DataBuffer::new(1, 1)),
        estimated_bytes,
    };
    let snapshots = HashMap::from([
        ("one".into(), snapshot("source", 400)),
        ("two".into(), snapshot("source", 500)),
    ]);

    assert_eq!(snapshot_memory_bytes(&snapshots), 900);
    assert!(snapshot_fits_memory_budget(900, 100, 1_000));
    assert!(!snapshot_fits_memory_budget(900, 101, 1_000));
    assert!(!snapshot_fits_memory_budget(usize::MAX, 1, usize::MAX));
}

#[test]
fn snapshot_release_and_budget_use_shared_registry() {
    let tb = Arc::new(app::AppState::new());
    assert!(tb.waveform_snapshots.lock().is_empty());
    tb.waveform_snapshots.lock().insert(
        "waveform-1".into(),
        WaveformSnapshot {
            source: "s".into(),
            buffer: Arc::new(DataBuffer::new(1, 1)),
            estimated_bytes: 10,
        },
    );
    super::release_waveform_snapshot(&tb, "waveform-1");
    assert!(tb.waveform_snapshots.lock().is_empty());
    assert!(tb.waveform_snapshots.lock().is_empty(), "共享同一注册表");
}
