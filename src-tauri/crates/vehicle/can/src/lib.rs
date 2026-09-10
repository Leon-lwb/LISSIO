//! # can
//!
//! CAN bus data types, buffer, and load statistics.
//!
//! Module breakdown:
//!
//! - [`can_frame`]: frame / direction / bitrate / filter / batch / candle device
//! - [`can_buffer`]: CAN frame ring buffer
//! - [`can_load_types`]: load statistic snapshot and history sampling types
//! - [`can_load_stats`]: sliding time-window load statistics
//! - [`test_data`]: test data generation utilities
//!
//! ## Design Principles
//!
//! 1. **Zero external crate dependencies**: only `serde` / `serde_json` (no `data_model` dependency,
//!    to break the Cargo cycle with `data_model::config::SlcanConfig` — `data_model` Layer 0
//!    needs `CanBitrate` from this crate for transport layer config).
//! 2. **serde first**: all wire types derive `Serialize`/`Deserialize`, for IPC with the frontend.
//! 3. **Single responsibility**: this crate does not depend on `tokio` / `serialport` or other I/O crates.

pub mod can_buffer;
pub mod can_frame;
pub mod can_load_stats;
pub mod can_load_types;
pub mod test_data;

pub use can_buffer::CanBuffer;
pub use can_frame::{
    CanDirection, CanFilter, CanFrame, CanFrameBatch, CanFrameFilter, CandleDeviceInfo,
};
pub use can_load_stats::{CanLoadStats, frame_bits};
pub use can_load_types::{CanIdLoadHistory, CanIdLoadStats, CanLoadHistoryPoint, CanLoadSnapshot};
pub use data_model::CanBitrate;
pub use test_data::CanFrameTestData;
