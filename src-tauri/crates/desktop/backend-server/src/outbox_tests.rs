use super::*;
use std::sync::Arc;

fn stream(id: u32, bytes: usize) -> OutFrame {
    OutFrame::StreamBinary {
        id,
        payload: vec![0_u8; bytes],
    }
}

#[tokio::test]
async fn stream_queue_is_bounded_by_frames_and_bytes() {
    let outbox = ConnectionOutbox::new();
    for _ in 0..100 {
        assert!(outbox.try_send_stream_lossy(stream(7, 1024 * 1024)));
    }

    let stats = outbox.stats();
    assert!(stats.queued_stream_frames <= STREAM_MAX_FRAMES);
    assert!(stats.queued_stream_bytes <= STREAM_MAX_BYTES);
    assert!(stats.dropped_stream_frames > 0);
    assert!(stats.dropped_stream_bytes > 0);
}

#[tokio::test]
async fn oversized_stream_frame_is_dropped_without_terminating_subscription() {
    let outbox = ConnectionOutbox::new();
    assert!(outbox.try_send_stream_lossy(stream(7, STREAM_MAX_BYTES + 1)));
    let stats = outbox.stats();
    assert_eq!(stats.queued_stream_frames, 0);
    assert_eq!(stats.dropped_stream_frames, 1);
}

#[tokio::test]
async fn remove_subscription_purges_only_that_subscriptions_frames() {
    let outbox = ConnectionOutbox::new();
    assert!(outbox.try_send_stream_lossy(stream(1, 32)));
    assert!(outbox.try_send_stream_lossy(stream(2, 64)));

    outbox.remove_subscription(1);
    let Some(OutFrame::StreamBinary { id, .. }) = outbox.recv().await else {
        panic!("应保留订阅 2 的帧");
    };
    assert_eq!(id, 2);
}

#[tokio::test]
async fn critical_control_send_waits_for_space_without_data_loss() {
    let outbox = Arc::new(ConnectionOutbox::new());
    for _ in 0..CONTROL_MAX_FRAMES {
        assert!(outbox.try_send_control_lossy(OutFrame::Pong));
    }

    let waiting_outbox = outbox.clone();
    let mut waiting = tokio::spawn(async move {
        waiting_outbox
            .send_control(OutFrame::Message(ServerMessage::Unsubscribed { id: 9 }))
            .await
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(20), &mut waiting)
            .await
            .is_err()
    );

    assert!(outbox.recv().await.is_some());
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(100), waiting)
            .await
            .expect("释放空间后控制帧应入队")
            .is_ok()
    );
}

#[tokio::test]
async fn close_releases_pending_frames_and_stops_senders() {
    let outbox = ConnectionOutbox::new();
    assert!(outbox.try_send_stream_lossy(stream(7, 128)));
    outbox.close();

    let stats = outbox.stats();
    assert_eq!(stats.queued_stream_frames, 0);
    assert_eq!(stats.queued_stream_bytes, 0);
    assert!(!outbox.try_send_stream_lossy(stream(7, 128)));
    assert!(outbox.recv().await.is_none());
}
