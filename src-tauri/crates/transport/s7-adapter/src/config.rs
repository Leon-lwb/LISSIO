use crate::planner::PlanError;
use points::PointId;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// S7 storage areas exposed by the adapter.
///
/// `Inputs` maps to the process image input area (I), `Outputs` to Q,
/// `Markers` to M (flags) and `Db` to a numbered data block. Absolute
/// addressing only: S7-1200/1500 data blocks must be non-optimized for byte
/// offsets to be stable.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum S7Area {
    Inputs,
    Outputs,
    Markers,
    Db,
}

impl S7Area {
    pub const fn writable(self) -> bool {
        !matches!(self, Self::Inputs)
    }

    pub const fn uses_db_number(self) -> bool {
        matches!(self, Self::Db)
    }

    pub const fn display_name(self) -> &'static str {
        match self {
            Self::Inputs => "I (inputs)",
            Self::Outputs => "Q (outputs)",
            Self::Markers => "M (markers)",
            Self::Db => "DB (data blocks)",
        }
    }

    pub const fn to_sdk(self) -> tokio_s7::types::S7Area {
        match self {
            Self::Inputs => tokio_s7::types::S7Area::Inputs,
            Self::Outputs => tokio_s7::types::S7Area::Outputs,
            Self::Markers => tokio_s7::types::S7Area::Flags,
            Self::Db => tokio_s7::types::S7Area::DataBlocks,
        }
    }
}

/// Value types decodable from consecutive big-endian PLC bytes. The S7 wire
/// format is big-endian by definition, so unlike Modbus there is no
/// configurable byte or word order.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum S7DataType {
    Bool,
    U8,
    I8,
    U16,
    I16,
    U32,
    I32,
    U64,
    I64,
    F32,
    F64,
}

impl S7DataType {
    /// Bytes occupied on the wire; a bool still reads its containing byte.
    pub const fn byte_size(self) -> u16 {
        match self {
            Self::Bool | Self::U8 | Self::I8 => 1,
            Self::U16 | Self::I16 => 2,
            Self::U32 | Self::I32 | Self::F32 => 4,
            Self::U64 | Self::I64 | Self::F64 => 8,
        }
    }
}

/// Target PLC family. Drives the ISO-on-TCP TSAP profile; rack and slot stay
/// independently configurable because real installs deviate from defaults.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum S7PlcType {
    S200,
    S200Smart,
    S300,
    S400,
    #[default]
    S1200,
    S1500,
}

impl S7PlcType {
    pub const fn to_sdk(self) -> tokio_s7::types::PlcType {
        match self {
            Self::S200 => tokio_s7::types::PlcType::S200,
            Self::S200Smart => tokio_s7::types::PlcType::S200Smart,
            Self::S300 => tokio_s7::types::PlcType::S300,
            Self::S400 => tokio_s7::types::PlcType::S400,
            Self::S1200 => tokio_s7::types::PlcType::S1200,
            Self::S1500 => tokio_s7::types::PlcType::S1500,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S7Point {
    pub id: PointId,
    pub area: S7Area,
    #[serde(default)]
    pub db_number: u16,
    pub byte_offset: u32,
    /// Bit index inside `byte_offset`; only meaningful for `Bool`.
    #[serde(default)]
    pub bit: u8,
    pub data_type: S7DataType,
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

impl S7Point {
    /// Bytes to read from the wire to obtain this point's value.
    pub const fn read_byte_size(&self) -> u16 {
        self.data_type.byte_size()
    }

    /// Bytes written back; bool writes use the native BIT transport instead.
    pub const fn write_byte_size(&self) -> Option<u16> {
        match self.data_type {
            S7DataType::Bool => None,
            size => Some(size.byte_size()),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectConfig {
    #[serde(default = "default_reconnect_attempts")]
    pub max_attempts: u32,
    #[serde(default = "default_reconnect_delay_ms")]
    pub initial_delay_ms: u64,
    #[serde(default = "default_reconnect_max_delay_ms")]
    pub max_delay_ms: u64,
}

const fn default_reconnect_attempts() -> u32 {
    3
}
const fn default_reconnect_delay_ms() -> u64 {
    100
}
const fn default_reconnect_max_delay_ms() -> u64 {
    2_000
}

impl Default for ReconnectConfig {
    fn default() -> Self {
        Self {
            max_attempts: default_reconnect_attempts(),
            initial_delay_ms: default_reconnect_delay_ms(),
            max_delay_ms: default_reconnect_max_delay_ms(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct S7Config {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub plc_type: S7PlcType,
    #[serde(default)]
    pub rack: u8,
    #[serde(default = "default_slot")]
    pub slot: u8,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub reconnect: ReconnectConfig,
    pub points: Vec<S7Point>,
}

const fn default_port() -> u16 {
    102
}
const fn default_slot() -> u8 {
    1
}
const fn default_timeout_ms() -> u64 {
    2_000
}

impl S7Config {
    pub fn validate(&self) -> Result<(), PlanError> {
        if self.host.trim().is_empty() {
            return Err(PlanError::InvalidConfig("host must not be empty".into()));
        }
        if self.port == 0 || self.timeout_ms == 0 {
            return Err(PlanError::InvalidConfig(
                "port and timeout must be non-zero".into(),
            ));
        }
        // The TSAP encodes rack in 3 bits and slot in 5 bits.
        if self.rack > 7 || self.slot > 31 {
            return Err(PlanError::InvalidConfig(
                "rack must be 0-7 and slot must be 0-31".into(),
            ));
        }
        validate_reconnect(&self.reconnect)?;
        validate_points(&self.points)
    }
}

fn validate_reconnect(reconnect: &ReconnectConfig) -> Result<(), PlanError> {
    if reconnect.initial_delay_ms > reconnect.max_delay_ms {
        return Err(PlanError::InvalidConfig(
            "initial reconnect delay exceeds maximum".into(),
        ));
    }
    Ok(())
}

/// The S7 any-pointer address field is 24 bits: `(byte_offset << 3) | bit`,
/// so byte offsets are capped at `0x1F_FFFF`.
pub const MAX_BYTE_OFFSET: u32 = 0x1F_FFFF;

fn validate_points(points: &[S7Point]) -> Result<(), PlanError> {
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
        if point.data_type != S7DataType::Bool && point.bit != 0 {
            return Err(PlanError::InvalidConfig(format!(
                "point {} is not bool but declares a bit offset",
                point.id.0
            )));
        }
        if point.bit > 7 {
            return Err(PlanError::InvalidConfig(format!(
                "bit offset must be 0-7 for {}",
                point.id.0
            )));
        }
        if point.area.uses_db_number() != (point.db_number != 0) {
            return Err(PlanError::InvalidConfig(format!(
                "dbNumber is only valid (and required) for db-area point {}",
                point.id.0
            )));
        }
        let end = point
            .byte_offset
            .checked_add(u32::from(point.read_byte_size()))
            .ok_or_else(|| {
                PlanError::InvalidConfig(format!("address range overflows for {}", point.id.0))
            })?;
        if end > MAX_BYTE_OFFSET {
            return Err(PlanError::InvalidConfig(format!(
                "byte offset {} exceeds the 24-bit S7 address space for {}",
                point.byte_offset, point.id.0
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(id: &str, area: S7Area, byte_offset: u32, data_type: S7DataType) -> S7Point {
        S7Point {
            id: PointId(id.into()),
            area,
            db_number: if area.uses_db_number() { 10 } else { 0 },
            byte_offset,
            bit: 0,
            data_type,
            scale: 1.0,
            offset: 0.0,
            poll_period_ms: 100,
        }
    }

    #[test]
    fn accepts_valid_config() {
        let config = S7Config {
            host: "127.0.0.1".into(),
            port: 102,
            plc_type: S7PlcType::S1200,
            rack: 0,
            slot: 1,
            timeout_ms: 2_000,
            reconnect: ReconnectConfig::default(),
            points: vec![
                point("flag", S7Area::Markers, 0, S7DataType::Bool),
                point("db", S7Area::Db, 4, S7DataType::F32),
            ],
        };
        config.validate().unwrap();
    }

    #[test]
    fn rejects_bit_on_non_bool_and_bad_db_number() {
        let mut config = S7Config {
            host: "127.0.0.1".into(),
            port: 102,
            plc_type: S7PlcType::S1200,
            rack: 0,
            slot: 1,
            timeout_ms: 2_000,
            reconnect: ReconnectConfig::default(),
            points: vec![point("word", S7Area::Markers, 0, S7DataType::U16)],
        };
        config.points[0].bit = 3;
        assert!(config.validate().is_err());

        config.points[0].bit = 0;
        config.points[0].db_number = 10;
        assert!(config.validate().is_err());

        config.points[0].area = S7Area::Db;
        config.validate().unwrap();
    }

    #[test]
    fn rejects_offsets_beyond_the_24_bit_address_space() {
        let config = S7Config {
            host: "127.0.0.1".into(),
            port: 102,
            plc_type: S7PlcType::S1200,
            rack: 0,
            slot: 1,
            timeout_ms: 2_000,
            reconnect: ReconnectConfig::default(),
            points: vec![point(
                "far",
                S7Area::Markers,
                MAX_BYTE_OFFSET,
                S7DataType::F64,
            )],
        };
        assert!(config.validate().is_err());
    }
}
