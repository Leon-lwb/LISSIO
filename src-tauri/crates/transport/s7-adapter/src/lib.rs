//! Siemens S7 TCP client adapter for the typed acquisition plane.
//!
//! Mirrors the `modbus-adapter` contract: a `SourceFactory` publishing
//! capability descriptors plus a polling `SourceSession` that projects raw
//! big-endian PLC bytes into rich `PointValue`s via `FlowEnvelope<PointBatch>`.

pub(crate) mod client;
mod codec;
mod config;
pub(crate) mod descriptor;
mod factory;
mod node_driver;
mod planner;
pub(crate) mod read;
mod write;

pub use client::S7Session;
pub use codec::{CodecError, decode_point, encode_point};
pub use config::{ReconnectConfig, S7Area, S7Config, S7DataType, S7PlcType, S7Point};
pub use factory::S7Factory;
pub use node_driver::S7Driver;
pub use planner::{PlanError, PlannedPoint, ReadPlan, plan_reads};

/// Stable driver identifier used in persisted driver payloads.
pub const DRIVER_ID: &str = "s7";
pub const SCHEMA_VERSION: u32 = 1;
