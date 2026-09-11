use acquisition::PointBatchObserver;
use pipeline::{SourceGraphs, data_plane::DataPlaneState, point_projection::PointProjection};
use points::PointEnvelope;

// clippy 误报: 私有根模块内的 pub(crate) 对 crate:: 路径访问是必需的 (private 会 E0603)
#[allow(clippy::redundant_pub_crate)]
pub(crate) struct FourDomainPointObserver(PointProjection);

#[allow(clippy::redundant_pub_crate)]
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
