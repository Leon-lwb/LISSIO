//! 后端测量流 — 权威缓冲金字塔快照上的统计/周期计算, version 门控 + 自适应速率

use std::sync::Arc;
use std::time::Duration;

use crate::AppState;

use super::{display_rate, send_json};
use crate::display::DisplayEvent;
use stream::sink::StreamSink;
use waveform::DerivedSeriesSelector;

pub(super) fn spawn_measurement_stream(
    state: &AppState,
    source: &str,
    window_ms: f64,
    derived: Vec<DerivedSeriesSelector>,
    on_event: Arc<dyn StreamSink>,
    interval: Duration,
) {
    let buffer = state.data_plane.buffer_for(source);
    let source = source.to_string();
    let channel_id = on_event.id();
    let mut cancel = subscription::register_cancel(&state.subscriptions, channel_id);
    let subscriptions = state.subscriptions.clone();
    let mut rate = display_rate(
        interval,
        state.data_plane.eval.bus.limits().preview_fps_limit,
    );
    tokio::spawn(async move {
        let mut seq: u64 = 0;
        let mut last_version: u64 = 0;
        loop {
            tokio::select! {
                _ = &mut cancel => break,
                () = tokio::time::sleep(rate.current()) => {
                    let version = { buffer.lock().version() };
                    if version == last_version {
                        rate.on_idle();
                        continue;
                    }
                    last_version = version;
                    seq = seq.wrapping_add(1);
                    let measurement = tokio::task::block_in_place(|| {
                        crate::compute_source_measurements(
                            &buffer,
                            &source,
                            window_ms,
                            &derived,
                            seq,
                        )
                    });
                    let Some(measurement) = measurement else {
                        rate.on_idle();
                        continue;
                    };
                    if !send_json(on_event.as_ref(), &DisplayEvent::Measurements(measurement)) {
                        break;
                    }
                    rate.on_send();
                }
            }
        }
        subscription::remove_subscription(&subscriptions, channel_id);
        log::debug!("测量订阅已结束: {channel_id}");
    });
}
