//! Modbus TCP client adapter.
//!
//! Only the Tokio TCP client feature is enabled. This crate does not implement
//! or claim Modbus ASCII, RTU, or server support.

mod client;
mod codec;
mod config;
mod planner;

pub use client::{ModbusFactory, ModbusSession};
pub use codec::{decode_registers, encode_registers, CodecError};
pub use config::{
    ByteOrder, ModbusArea, ModbusConfig, ModbusDataType, ModbusPoint, ReconnectConfig, WordOrder,
};
pub use planner::{plan_reads, PlanError, PlannedPoint, ReadPlan};

/// Stable driver identifier used in persisted driver payloads.
pub const DRIVER_ID: &str = "modbus-tcp";
pub const SCHEMA_VERSION: u32 = 1;
