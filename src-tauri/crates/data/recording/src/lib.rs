//! Durable recording for the bytes, string, numeric, and spectrum domains.
//!
//! The database connection is owned by one writer thread. Producers submit typed
//! batches through a bounded queue and receive explicit backpressure; UI code and
//! upstream crates never receive a database connection.
//!
//! 契约边界: **数据库侧的任何问题都不得波及采集**。打不开、writer 卡住、
//! 用户关掉总开关 ([`RecordingHub::disable`])、队列一时打满, 一律只是「没有
//! 录制」; 只有已受理批次真的落不了盘才允许停止采集 ([`RecordingFault`])。

mod codec;
mod export;
mod hub;
mod maintenance;
mod model;
mod read_model;
mod repair;
mod schema;
mod store;
mod writer;

pub use export::export_recording_data;
pub use hub::{RecordingFault, RecordingHub};
pub use model::{
    BatchPayload, BindingCapability, BindingInfo, DisplayBinding, Domain, HistoryQuery,
    PortIdentity, RecordBatch, RecordingCleanupPolicy, RecordingCleanupResult,
    RecordingDatabaseInfo, RecordingExportFormat, RecordingExportRequest, RecordingExportResult,
    RecordingHealth, RecordingLimits, SessionInfo, SessionState, SessionSummary, StoredBatch,
};
pub use store::{HistoryPage, RecordingStore, SqlResult};
pub use writer::{Recorder, RecordingError};
