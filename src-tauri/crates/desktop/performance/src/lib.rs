//! # performance
//!
//! Backend-side performance sampling for the unified performance monitor.
//!
//! The crate owns the backend wire snapshot and a bounded in-memory recorder.
//! Platform process information is sampled by the L4 implementation here; the
//! frontend supplies its own renderer metrics and only renders both series.

mod model;
mod monitor;

pub use model::{
    BackendPerformanceSnapshot, PipelinePerformance, ProcessPerformance, RpcPerformance,
    WebSocketPerformance,
};
pub use monitor::PerformanceMonitor;
