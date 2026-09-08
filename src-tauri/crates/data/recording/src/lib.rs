//! Durable recording for the bytes, string, numeric, and spectrum domains.
//!
//! The database connection is owned by one writer thread. Producers submit typed
//! batches through a bounded queue and receive explicit backpressure; UI code and
//! upstream crates never receive a database connection.

mod codec;
mod hub;
mod model;
mod store;
mod writer;

pub use hub::RecordingHub;
pub use model::{
    BatchPayload, BindingCapability, DisplayBinding, Domain, PortIdentity, RecordBatch,
    RecordingHealth, RecordingLimits, SessionInfo, SessionState, StoredBatch,
};
pub use store::{HistoryPage, RecordingStore, SqlResult};
pub use writer::{Recorder, RecordingError};
