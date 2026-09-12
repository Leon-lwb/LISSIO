//! Durable recording for the bytes, string, numeric, and spectrum domains.
//!
//! The database connection is owned by one writer thread. Producers submit typed
//! batches through a bounded queue and receive explicit backpressure; UI code and
//! upstream crates never receive a database connection.

mod codec;
mod export;
mod hub;
mod maintenance;
mod model;
mod read_model;
mod repair;
mod store;
mod writer;

pub use export::export_recording_data;
pub use hub::RecordingHub;
pub use model::{
    BatchPayload, BindingCapability, BindingInfo, DisplayBinding, Domain, HistoryQuery,
    PortIdentity, RecordBatch, RecordingCleanupPolicy, RecordingCleanupResult,
    RecordingDatabaseInfo, RecordingExportFormat, RecordingExportRequest, RecordingExportResult,
    RecordingHealth, RecordingLimits, SessionInfo, SessionState, SessionSummary, StoredBatch,
};
pub use store::{HistoryPage, RecordingStore, SqlResult};
pub use writer::{Recorder, RecordingError};
