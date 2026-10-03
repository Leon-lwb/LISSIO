//! Backend performance snapshot RPC.

use backend_host::BackendHost;
use performance::PipelinePerformance;
use serde_json::Value;

use crate::args::{RpcError, encode};

/// Read one complete backend performance sample.
pub fn get_snapshot(host: &BackendHost) -> Result<Value, RpcError> {
    let pipeline = PipelinePerformance::from_runtime(
        host.state.data_plane.eval_diagnostics(),
        app::display::get_data_health(&host.state).map_err(|error| RpcError::domain(&error))?,
    );
    encode(&host.performance.snapshot(pipeline))
}
