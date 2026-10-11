use crate::planner::PlanError;
use points::PointId;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModbusArea {
    Coils,
    DiscreteInputs,
    InputRegisters,
    HoldingRegisters,
}

impl ModbusArea {
    pub const fn is_bits(self) -> bool {
        matches!(self, Self::Coils | Self::DiscreteInputs)
    }

    pub const fn writable(self) -> bool {
        matches!(self, Self::Coils | Self::HoldingRegisters)
    }

    pub const fn max_read_quantity(self) -> u16 {
        if self.is_bits() { 2_000 } else { 125 }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ModbusDataType {
    Bool,
    U16,
    I16,
    U32,
    I32,
    U64,
    I64,
    F32,
    F64,
}

impl ModbusDataType {
    pub const fn register_count(self) -> u16 {
        match self {
            Self::Bool | Self::U16 | Self::I16 => 1,
            Self::U32 | Self::I32 | Self::F32 => 2,
            Self::U64 | Self::I64 | Self::F64 => 4,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ByteOrder {
    #[default]
    Big,
    Little,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WordOrder {
    #[default]
    Big,
    Little,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusPoint {
    pub id: PointId,
    pub area: ModbusArea,
    pub address: u16,
    pub data_type: ModbusDataType,
    #[serde(default)]
    pub byte_order: ByteOrder,
    #[serde(default)]
    pub word_order: WordOrder,
    #[serde(default = "default_scale")]
    pub scale: f64,
    #[serde(default)]
    pub offset: f64,
    #[serde(default = "default_poll_period_ms")]
    pub poll_period_ms: u64,
}

const fn default_scale() -> f64 {
    1.0
}
const fn default_poll_period_ms() -> u64 {
    1_000
}

impl ModbusPoint {
    pub const fn quantity(&self) -> u16 {
        if self.area.is_bits() {
            1
        } else {
            self.data_type.register_count()
        }
    }
}

pub use acquisition::config::ReconnectConfig;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusConfig {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_unit")]
    pub unit_id: u8,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub reconnect: ReconnectConfig,
    pub points: Vec<ModbusPoint>,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SerialDataBits {
    Seven,
    #[default]
    Eight,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SerialParity {
    #[default]
    None,
    Odd,
    Even,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SerialStopBits {
    #[default]
    One,
    Two,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SerialFlowControl {
    #[default]
    None,
    Software,
    Hardware,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModbusRtuConfig {
    pub port_name: String,
    #[serde(default = "default_baud_rate")]
    pub baud_rate: u32,
    #[serde(default)]
    pub data_bits: SerialDataBits,
    #[serde(default)]
    pub parity: SerialParity,
    #[serde(default)]
    pub stop_bits: SerialStopBits,
    #[serde(default)]
    pub flow_control: SerialFlowControl,
    #[serde(default = "default_unit")]
    pub unit_id: u8,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub reconnect: ReconnectConfig,
    pub points: Vec<ModbusPoint>,
}

const fn default_port() -> u16 {
    502
}
const fn default_unit() -> u8 {
    1
}
const fn default_timeout_ms() -> u64 {
    2_000
}
const fn default_baud_rate() -> u32 {
    9_600
}

impl ModbusConfig {
    pub fn validate(&self) -> Result<(), PlanError> {
        if self.host.trim().is_empty() {
            return Err(PlanError::InvalidConfig("host must not be empty".into()));
        }
        if self.port == 0 || self.timeout_ms == 0 {
            return Err(PlanError::InvalidConfig(
                "port and timeout must be non-zero".into(),
            ));
        }
        validate_reconnect(&self.reconnect)?;
        validate_points(&self.points)
    }
}

impl ModbusRtuConfig {
    pub fn validate(&self) -> Result<(), PlanError> {
        if self.port_name.trim().is_empty() {
            return Err(PlanError::InvalidConfig(
                "serial port name must not be empty".into(),
            ));
        }
        if self.baud_rate == 0 || self.timeout_ms == 0 {
            return Err(PlanError::InvalidConfig(
                "baud rate and timeout must be non-zero".into(),
            ));
        }
        validate_reconnect(&self.reconnect)?;
        validate_points(&self.points)
    }
}

fn validate_reconnect(reconnect: &ReconnectConfig) -> Result<(), PlanError> {
    reconnect.validate().map_err(PlanError::InvalidConfig)
}

fn validate_points(points: &[ModbusPoint]) -> Result<(), PlanError> {
    let mut ids = HashSet::new();
    for point in points {
        if point.id.0.trim().is_empty() || !ids.insert(point.id.clone()) {
            return Err(PlanError::InvalidConfig(format!(
                "empty or duplicate point id: {}",
                point.id.0
            )));
        }
        if point.poll_period_ms == 0 || !point.scale.is_finite() || !point.offset.is_finite() {
            return Err(PlanError::InvalidConfig(format!(
                "invalid timing or scale for {}",
                point.id.0
            )));
        }
        if point.area.is_bits() && point.data_type != ModbusDataType::Bool {
            return Err(PlanError::InvalidConfig(format!(
                "bit area point {} must be bool",
                point.id.0
            )));
        }
        point
            .address
            .checked_add(point.quantity().saturating_sub(1))
            .ok_or_else(|| {
                PlanError::InvalidConfig(format!("address range overflows for {}", point.id.0))
            })?;
    }
    Ok(())
}
