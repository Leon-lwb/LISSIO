use super::*;
use std::time::Duration;

#[tokio::test]
async fn zero_is_a_valid_sample_but_waiting_has_no_sample() {
    let bus = DataBus::default();
    let key = TopicKey::new("protocol", "ch3");
    let mut rx = bus.subscribe(key.clone(), 500).await.unwrap();
    bus.publish_samples(key, Arc::from([10]), Arc::from([0.0]));
    let batch = rx.recv().await.unwrap();
    assert_eq!(batch.status, SampleStatus::Live);
    assert!(batch.samples[0].value.abs() < f64::EPSILON);
}

#[tokio::test]
async fn invalid_channel_status_does_not_fabricate_zero() {
    let bus = DataBus::default();
    let key = TopicKey::new("protocol", "ch9");
    let mut rx = bus.subscribe(key.clone(), 500).await.unwrap();
    bus.set_status(
        key,
        SampleStatus::ChannelOutOfRange {
            requested: 9,
            available: 4,
        },
    );
    let batch = rx.recv().await.unwrap();
    assert!(batch.samples.is_empty());
    assert!(matches!(
        batch.status,
        SampleStatus::ChannelOutOfRange { .. }
    ));
}

#[tokio::test]
async fn topic_activity_tracks_subscription_lifetime() {
    let bus = DataBus::default();
    let key = TopicKey::new("protocol", "ch0");
    let _receiver = bus.subscribe(key.clone(), 500).await.unwrap();
    assert!(bus.is_active(&key));
    assert_eq!(bus.health().active_topics, 1);

    bus.register_subscription(42, key.clone());
    bus.ack_subscription(42, 7, 0, 1.0);
    assert_eq!(bus.health().last_ack_sequence, 7);

    bus.unregister_subscription(42);
    assert!(!bus.is_active(&key));
    assert_eq!(bus.health().active_topics, 0);
}

#[tokio::test]
async fn replay_is_bounded_to_latest_samples() {
    let bus = DataBus::default();
    let key = TopicKey::new("protocol", "ch1");
    let mut first = bus.subscribe(key.clone(), 500).await.unwrap();
    bus.publish_samples(
        key.clone(),
        Arc::from([1, 2, 3, 4, 5]),
        Arc::from([1.0, 2.0, 3.0, 4.0, 5.0]),
    );
    let _ = first.recv().await.unwrap();
    bus.unsubscribe(&key);

    let mut replay = bus.subscribe(key, 2).await.unwrap();
    let batch = replay.recv().await.unwrap();
    assert_eq!(
        batch
            .samples
            .iter()
            .map(|sample| sample.value)
            .collect::<Vec<_>>(),
        vec![4.0, 5.0]
    );
}

#[tokio::test]
async fn lifecycle_status_bypasses_saturated_ingress() {
    let bus = DataBus::default();
    let key = TopicKey::new("protocol", "ch2");
    let mut rx = bus.subscribe(key.clone(), 1).await.unwrap();
    let waiter = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(batch) if batch.status == SampleStatus::Disconnected => break batch,
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(error) => panic!("topic closed before disconnect status: {error}"),
            }
        }
    });
    for i in 0..u32::try_from(COMMAND_CAPACITY * 4).unwrap() {
        bus.publish_samples(
            key.clone(),
            Arc::from([u64::from(i)]),
            Arc::from([f64::from(i)]),
        );
    }
    bus.set_status(key, SampleStatus::Disconnected);

    let status = tokio::time::timeout(Duration::from_millis(100), waiter)
        .await
        .expect("disconnect status should not wait behind sample ingress")
        .unwrap();
    assert!(status.samples.is_empty());
}
