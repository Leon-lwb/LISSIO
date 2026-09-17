//! 样本预览流 — bus Topic 订阅 → VNDP 二进制推送 (最新批胜出)

use std::sync::Arc;
use std::time::Duration;

use crate::AppState;
use bus::{SampleBatch, TopicKey};

use super::binary::encode_samples;
use crate::display::stream_sink::{StreamPayload, StreamSink};

pub(super) async fn spawn_sample_stream(
    state: &AppState,
    key: TopicKey,
    on_event: Arc<dyn StreamSink>,
    interval: Duration,
    max_items: usize,
) -> bool {
    let bus = state.data_plane.eval.bus.clone();
    let max_items = max_items.max(1);
    let Some(mut receiver) = bus.subscribe(key.clone(), max_items).await else {
        return false;
    };
    let channel_id = on_event.id();
    bus.register_subscription(channel_id, key.clone());
    let mut cancel = subscription::register_cancel(&state.subscriptions, channel_id);
    let subscriptions = state.subscriptions.clone();
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval.max(Duration::from_millis(1)));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut pending: Option<std::sync::Arc<SampleBatch>> = None;
        let mut stream_preview_skipped = 0_u64;
        let mut skipped_since_report = 0_u64;
        loop {
            tokio::select! {
                biased;
                _ = &mut cancel => break,
                _ = ticker.tick() => {
                    let Some(batch) = pending.take() else { continue };
                    let start = batch.samples.len().saturating_sub(max_items);
                    let limited = SampleBatch {
                        topic: batch.topic.clone(),
                        sequence: batch.sequence,
                        samples: batch.samples[start..].to_vec().into(),
                        status: batch.status.clone(),
                        preview_skipped: stream_preview_skipped.max(batch.preview_skipped),
                        retention_evicted: batch.retention_evicted,
                        ingress_dropped: batch.ingress_dropped,
                    };
                    if skipped_since_report > 0 {
                        bus.record_preview_skipped(&key, skipped_since_report);
                        skipped_since_report = 0;
                    }
                    if !on_event.send(StreamPayload::Binary(encode_samples(&limited))) {
                        break;
                    }
                }
                event = receiver.recv() => match event {
                    Ok(batch) => {
                        stream_preview_skipped = stream_preview_skipped.max(batch.preview_skipped);
                        if pending.replace(batch).is_some() {
                            stream_preview_skipped = stream_preview_skipped.saturating_add(1);
                            skipped_since_report = skipped_since_report.saturating_add(1);
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        bus.record_preview_skipped(&key, skipped);
                        log::debug!("样本预览跳过 {skipped} 批: channel={channel_id}");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
        bus.unregister_subscription(channel_id);
        subscription::remove_subscription(&subscriptions, channel_id);
    });
    true
}
