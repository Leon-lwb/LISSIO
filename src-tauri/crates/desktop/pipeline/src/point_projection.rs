//! Points enter the numeric graph only through explicit PointSelector nodes.
use crate::runtime::SourceGraphs;
use crate::{
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
#[path = "point_projection_tests.rs"]
mod tests;
