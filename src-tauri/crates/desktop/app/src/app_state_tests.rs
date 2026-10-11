use super::{AppState, WaveformSnapshot};
use kind::{NodeDef, NodeKind};
use schema_types::ProtocolConfig;
use std::sync::Arc;
use waveform::DataBuffer;

#[test]
fn prune_waveform_snapshots_releases_orphaned_sources() {
    let state = AppState::new();
    state.data_plane.global_nodes.lock().insert(
        "live".into(),
        NodeDef::new(
            "live".into(),
            "tab".into(),
            NodeKind::Protocol {
                schema: schema_types::schema_from_protocol_config(&ProtocolConfig::FireWater {
                    channels: Some(1),
                }),
                config: ProtocolConfig::FireWater { channels: Some(1) },
                convert_to: None,
            },
        ),
    );
    for (id, source) in [("keep", "live"), ("release", "gone")] {
        state.waveform_snapshots.lock().insert(
            id.into(),
            WaveformSnapshot {
                source: source.into(),
                buffer: Arc::new(DataBuffer::new(4, 1)),
                estimated_bytes: 48,
            },
        );
    }

    state.prune_waveform_snapshots();

    let snapshots = state.waveform_snapshots.lock();
    assert!(snapshots.contains_key("keep"));
    assert!(!snapshots.contains_key("release"));
}

/// 恢复完成门必须在"发信号时还没有订阅者"的时序下也放行迟到订阅者。
///
/// 无界面出口在装配期同步发信号 (此时服务端还没人订阅), 而 `AppState` 构造时
/// 丢弃了初始 receiver — `watch::Sender::send` 在零接收者时不写入值, 因此
/// 迟到订阅者会永远等不到 `changed()` (表现为 `workspace_get` 挂起)。
#[tokio::test]
async fn restore_done_signal_reaches_late_subscribers() {
    let state = AppState::new();
    state.signal_restore_done();

    let mut late = state.subscribe_restore_done();
    assert!(*late.borrow_and_update(), "迟到订阅者必须直接看到已完成");

    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        crate::workspace::await_restore_done(&state),
    )
    .await
    .expect("已完成的门不得再挂起等待");
}

/// 先订阅再发信号同样放行, 且不会漏掉变更。
#[tokio::test]
async fn restore_done_signal_wakes_existing_subscribers() {
    let state = AppState::new();
    let mut waiting = state.subscribe_restore_done();
    assert!(!*waiting.borrow_and_update());

    state.signal_restore_done();
    tokio::time::timeout(std::time::Duration::from_secs(1), waiting.changed())
        .await
        .expect("发信号必须唤醒等待方")
        .expect("发送端常驻, 不应关闭");
    assert!(*waiting.borrow_and_update());
}
