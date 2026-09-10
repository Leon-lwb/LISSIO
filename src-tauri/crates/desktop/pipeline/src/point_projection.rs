//! Points enter the numeric graph only through explicit PointSelector nodes.
use crate::{
    SourceGraphs,
    data_plane::{DataPlaneState, frame_dispatch},
    eval_state::GraphEvalState,
};
use data_model::DataFrame;
use kind::{NodeDef, NodeKind};
use parking_lot::Mutex;
use points::{PointEnvelope, PointSample};
use std::{collections::HashMap, sync::Arc};
use waveform::DataBuffer;

type LatestPoints = HashMap<String, (u64, HashMap<String, PointSample>)>;

fn merge_latest(latest: &mut LatestPoints, source: &str, envelope: &PointEnvelope) {
    let entry = latest
        .entry(source.to_owned())
        .or_insert_with(|| (envelope.connection_epoch, HashMap::new()));
    if entry.0 != envelope.connection_epoch {
        *entry = (envelope.connection_epoch, HashMap::new());
    }
    for sample in &envelope.payload.samples {
        entry
            .1
            .insert(sample.key.point_id.0.clone(), sample.clone());
    }
}

fn project(points: &[String], samples: &HashMap<String, PointSample>) -> Vec<f32> {
    points
        .iter()
        .map(|point| {
            samples
                .get(point)
                .and_then(points::projection::numeric)
                .unwrap_or(f32::NAN)
        })
        .collect()
}

/// Holds data-plane ports, never the session owner (no runtime/observer ownership cycle).
pub struct PointProjection {
    eval: GraphEvalState,
    nodes: Arc<Mutex<HashMap<String, NodeDef>>>,
    buffers: Arc<Mutex<HashMap<String, Arc<Mutex<DataBuffer>>>>>,
    graphs: SourceGraphs,
    latest: Mutex<LatestPoints>,
}

impl PointProjection {
    pub fn new(plane: &DataPlaneState, graphs: SourceGraphs) -> Self {
        Self {
            eval: plane.eval.clone(),
            nodes: plane.global_nodes.clone(),
            buffers: plane.buffers.clone(),
            graphs,
            latest: Mutex::new(HashMap::new()),
        }
    }

    pub fn accept(&self, envelope: &PointEnvelope) {
        let source = envelope.source_id.as_str().to_owned();
        {
            let mut latest = self.latest.lock();
            merge_latest(&mut latest, &source, envelope);
        }
        let selectors = self
            .graphs
            .lock()
            .values()
            .flat_map(|graph| {
                graph.edges.iter().filter_map(|edge| {
                    if edge.source != envelope.source_id.as_str() || edge.target_handle != "points"
                    {
                        return None;
                    }
                    graph.nodes.iter().find_map(|node| match &node.kind {
                        NodeKind::PointSelector { points } if node.id == edge.target => {
                            Some((node.id.clone(), points.clone()))
                        }
                        _ => None,
                    })
                })
            })
            .collect::<Vec<_>>();
        for (id, points) in selectors {
            if points.is_empty() {
                continue;
            }
            let timestamp =
                u64::try_from(envelope.observed_time_unix_ns.max(0)).unwrap_or_default() / 1000;
            // Partial point batches retain the latest value only within the same connection generation.
            // Bad quality remains NaN and therefore never masquerades as a valid numeric sample.
            let channels = {
                let latest = self.latest.lock();
                let samples = &latest[&source].1;
                project(&points, samples)
            };
            let frame = DataFrame {
                timestamp,
                channels,
            };
            let buffer = self
                .buffers
                .lock()
                .entry(id.clone())
                .or_insert_with(|| Arc::new(Mutex::new(DataBuffer::new(100_000, points.len()))))
                .clone();
            buffer.lock().push_frame_at(timestamp, &frame.channels);
            frame_dispatch::publish_protocol_samples(
                &self.eval,
                &self.nodes,
                &id,
                std::slice::from_ref(&frame),
            );
            frame_dispatch::eval_frames(
                &self.eval,
                &self.nodes,
                &buffer,
                &id,
                &[frame],
                frame_dispatch::EvalOptions {
                    workers: 1,
                    simd: false,
                },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flow::{Direction, FlowEnvelope, SourceId};
    use points::{
        DeliveryClass, PointBatch, PointId, PointKey, PointQuality, PointValue, Validity,
    };

    fn envelope(epoch: u64, values: &[(&str, f64, Validity)]) -> PointEnvelope {
        FlowEnvelope {
            source_id: SourceId::new("device").unwrap(),
            connection_epoch: epoch,
            first_sequence: 0,
            last_sequence: 0,
            observed_time_unix_ns: 0,
            direction: Direction::Receive,
            gap_before: None,
            payload: PointBatch {
                delivery: DeliveryClass::State,
                samples: values
                    .iter()
                    .map(|(id, value, validity)| PointSample {
                        key: PointKey {
                            source_id: SourceId::new("device").unwrap(),
                            point_id: PointId((*id).into()),
                        },
                        value: Some(PointValue::F64(*value)),
                        quality: PointQuality {
                            validity: *validity,
                            flags: 0,
                            native: None,
                        },
                        source_time_unix_ns: None,
                        server_time_unix_ns: None,
                        received_time_unix_ns: 0,
                    })
                    .collect(),
            },
        }
    }

    #[test]
    fn partial_batches_retain_only_same_generation_values() {
        let mut latest = LatestPoints::new();
        merge_latest(
            &mut latest,
            "device",
            &envelope(1, &[("a", 1.0, Validity::Good)]),
        );
        merge_latest(
            &mut latest,
            "device",
            &envelope(1, &[("b", 2.0, Validity::Good)]),
        );
        assert_eq!(
            project(&["a".into(), "b".into()], &latest["device"].1),
            vec![1.0, 2.0]
        );

        merge_latest(
            &mut latest,
            "device",
            &envelope(2, &[("b", 3.0, Validity::Bad)]),
        );
        let reset = project(&["a".into(), "b".into()], &latest["device"].1);
        assert!(
            reset[0].is_nan(),
            "old connection values must not leak after reconnect"
        );
        assert!(reset[1].is_nan(), "bad quality must remain visibly invalid");
    }
}
