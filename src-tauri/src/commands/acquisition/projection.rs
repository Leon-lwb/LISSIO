use acquisition::PointBatchObserver;
use pipeline::{SourceGraphs, data_plane::DataPlaneState, point_projection::PointProjection};
use points::PointEnvelope;

pub(crate) struct FourDomainPointObserver(PointProjection);

impl FourDomainPointObserver {
    pub(crate) fn new(plane: &DataPlaneState, graphs: SourceGraphs) -> Self {
        Self(PointProjection::new(plane, graphs))
    }
}

impl PointBatchObserver for FourDomainPointObserver {
    fn observe(&self, envelope: &PointEnvelope) {
        self.0.accept(envelope);
    }
}
