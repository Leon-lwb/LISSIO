use std::sync::Arc;

use bus::TopicKey;

use crate::eval_state::GraphEvalState;

pub(super) struct PortSampleBatch {
    pub key: TopicKey,
    pub graph_index: usize,
    pub slot: usize,
    pub timestamps: Vec<u64>,
    pub values: Vec<f64>,
}

pub(super) struct PortTextBatch {
    pub port: recording::PortIdentity,
    pub graph_index: usize,
    pub slot: usize,
    pub timestamps: Vec<u64>,
    pub values: Vec<String>,
}

pub(super) fn record_spectrum(
    eval: &GraphEvalState,
    source_id: &str,
    timestamp_us: u64,
    spectrum: &spectrum::SpectrumResult,
) {
    let port = recording::PortIdentity::new(source_id, "spectrum");
    if !eval.recording.is_bound(&port) {
        return;
    }
    if let Err(error) = eval.recording.record_next(
        &port,
        eval.execution.snapshot().epoch,
        vec![timestamp_us],
        recording::BatchPayload::Spectrum {
            frequencies: spectrum
                .frequencies
                .iter()
                .map(|value| f64::from(*value))
                .collect(),
            values: spectrum
                .values
                .iter()
                .map(|value| f64::from(*value))
                .collect(),
        },
    ) {
        log::error!("spectrum recording stopped accepting data: {error}");
    }
}

pub(super) fn publish_recorded_batches(
    eval: &GraphEvalState,
    numeric: Vec<PortSampleBatch>,
    text: Vec<PortTextBatch>,
    static_numeric: Vec<(TopicKey, u64, f64)>,
) {
    for batch in numeric {
        if batch.values.is_empty() {
            continue;
        }
        let port =
            recording::PortIdentity::new(&batch.key.source_node_id, &batch.key.source_handle);
        if eval.recording.is_bound(&port)
            && let Err(error) = eval.recording.record_next(
                &port,
                eval.execution.snapshot().epoch,
                batch.timestamps.clone(),
                recording::BatchPayload::Float {
                    values: batch.values.clone(),
                },
            )
        {
            log::error!("numeric recording stopped accepting data: {error}");
        }
        if eval.bus.is_active(&batch.key) {
            eval.bus.publish_samples(
                batch.key,
                Arc::from(batch.timestamps),
                Arc::from(batch.values),
            );
        }
    }
    for batch in text {
        if batch.values.is_empty() {
            continue;
        }
        if let Err(error) = eval.recording.record_next(
            &batch.port,
            eval.execution.snapshot().epoch,
            batch.timestamps,
            recording::BatchPayload::String {
                values: batch.values,
            },
        ) {
            log::error!("string recording stopped accepting data: {error}");
        }
    }
    for (key, timestamp, value) in static_numeric {
        let port = recording::PortIdentity::new(&key.source_node_id, &key.source_handle);
        if eval.recording.is_bound(&port)
            && let Err(error) = eval.recording.record_next(
                &port,
                eval.execution.snapshot().epoch,
                vec![timestamp],
                recording::BatchPayload::Float {
                    values: vec![value],
                },
            )
        {
            log::error!("static numeric recording stopped accepting data: {error}");
        }
        if eval.bus.is_active(&key) {
            eval.bus
                .publish_samples(key, Arc::from([timestamp]), Arc::from([value]));
        }
    }
}
