//! 波形包络流 — 快照语义 (buffer 版本变化即推送), 组合根注入的包络引擎
//! (GPU 加速 + CPU 回退, 见 `waveform::EnvelopeEngine` 端口)

use std::sync::Arc;
use std::time::Duration;

use crate::AppState;
use parking_lot::Mutex;
use waveform::DataBuffer;

use super::binary::{ENVELOPE_WINDOW_CAP, encode_envelope};
use super::display_rate;
use stream::sink::{StreamPayload, StreamSink};

pub(super) fn spawn_envelope_stream(
    state: &AppState,
    buffer: Arc<Mutex<DataBuffer>>,
    columns: usize,
    on_event: Arc<dyn StreamSink>,
    interval: Duration,
) {
    let engine = state.envelope_engine();
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
                    let (window, version) = {
                        // block_in_place: 大窗口提取 + 压缩可达数十毫秒, 不占并发 worker
                        let buffer = buffer.clone();
                        tokio::task::block_in_place(move || {
                            let buf = buffer.lock();
                            let version = buf.version();
                            if version == last_version {
                                return (None, version);
                            }
                            let pts = buf.point_count().min(ENVELOPE_WINDOW_CAP);
                            (Some(buf.get_recent(pts)), version)
                        })
                    };
                    let Some(window) = window else {
                        rate.on_idle();
                        continue;
                    };
                    last_version = version;
                    // 包络引擎含 GPU 路径 — 阻塞区执行, 不占并发 worker
                    let envelopes = tokio::task::block_in_place(|| {
                        let columns = columns.max(1);
                        window
                            .channels
                            .iter()
                            .map(|channel| engine.envelope_minmax(channel, columns))
                            .collect::<Vec<_>>()
                    });
                    seq += 1;
                    let frame = encode_envelope(seq, &window, columns.max(1), &envelopes);
                    if !on_event.send(StreamPayload::Binary(frame)) {
                        break;
                    }
                    rate.on_send();
                }
            }
        }
        subscription::remove_subscription(&subscriptions, channel_id);
        log::debug!("波形包络订阅已结束: {channel_id}");
    });
}
