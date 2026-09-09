//! Modbus TCP and RTU client adapters for the typed acquisition plane.

pub(crate) mod client;
mod codec;
mod config;
pub(crate) mod descriptor;
mod factory;
mod planner;
pub(crate) mod read;
#[cfg(test)]
mod rtu_tests;
mod write;

pub use client::ModbusSession;
pub use codec::{decode_registers, encode_registers, CodecError};
pub use config::{
    ByteOrder, ModbusArea, ModbusConfig, ModbusDataType, ModbusPoint, ModbusRtuConfig,
    ReconnectConfig, SerialDataBits, SerialFlowControl, SerialParity, SerialStopBits, WordOrder,
};
pub use factory::{ModbusFactory, ModbusRtuFactory};
pub use planner::{plan_reads, PlanError, PlannedPoint, ReadPlan};

/// Stable driver identifier used in persisted driver payloads.
pub const DRIVER_ID: &str = "modbus-tcp";
pub const RTU_DRIVER_ID: &str = "modbus-rtu";
pub const SCHEMA_VERSION: u32 = 1;
