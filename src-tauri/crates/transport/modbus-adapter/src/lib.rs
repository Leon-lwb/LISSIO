//! Modbus TCP and RTU client adapters for the typed acquisition plane.

pub(crate) mod client;
mod codec;
mod config;
pub(crate) mod descriptor;
mod factory;
mod node_driver;
mod planner;
pub(crate) mod read;
#[cfg(test)]
mod rtu_tests;
mod write;

pub use client::ModbusSession;
pub use codec::{CodecError, decode_registers, encode_registers};
pub use config::{
    ByteOrder, ModbusArea, ModbusConfig, ModbusDataType, ModbusPoint, ModbusRtuConfig,
    ReconnectConfig, SerialDataBits, SerialFlowControl, SerialParity, SerialStopBits, WordOrder,
};
pub use factory::{ModbusFactory, ModbusRtuFactory};
pub use node_driver::{ModbusRtuDriver, ModbusTcpDriver};
pub use planner::{PlanError, PlannedPoint, ReadPlan, plan_reads};

/// Stable driver identifier used in persisted driver payloads.
pub const DRIVER_ID: &str = "modbus-tcp";
pub const RTU_DRIVER_ID: &str = "modbus-rtu";
pub const SCHEMA_VERSION: u32 = 1;
