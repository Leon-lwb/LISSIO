//! Protocol-neutral point contracts.
//!
//! Values retain their native width and quality until an explicit numeric
//! projection is requested. Protocol-specific addresses and native status are
//! preserved at the cold configuration/inspection boundary.

use flow::FlowEnvelope;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Stable point identity within a source.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PointId(pub String);

/// Fully qualified point key.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointKey {
    pub source_id: flow::SourceId,
    pub point_id: PointId,
}

/// Ordered field of a structured value.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructField {
    pub name: String,
    pub value: PointValue,
}

/// Lossless protocol-neutral value representation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum PointValue {
    Null,
    Bool(bool),
    I64(#[serde(with = "signed_string")] i64),
    U64(#[serde(with = "unsigned_string")] u64),
    F64(f64),
    Decimal(String),
    String(String),
    Bytes(Vec<u8>),
    DateTime(#[serde(with = "signed_string")] i64),
    Enum {
        #[serde(with = "signed_string")]
        value: i64,
        label: Option<String>,
    },
    Array(Vec<Self>),
    Struct(Vec<StructField>),
}

mod signed_string {
    use serde::{de::Error, Deserialize, Deserializer, Serializer};

    // serde(with = ...) 的 serialize 契约要求 &T 形参, 8 字节原语按引用传入
    // 是外部接口约束而非风格选择
    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn serialize<S: Serializer>(value: &i64, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&value.to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
        String::deserialize(deserializer)?
            .parse()
            .map_err(D::Error::custom)
    }
}

mod unsigned_string {
    use serde::{de::Error, Deserialize, Deserializer, Serializer};

    #[allow(clippy::trivially_copy_pass_by_ref)]
    pub fn serialize<S: Serializer>(value: &u64, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&value.to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
        String::deserialize(deserializer)?
            .parse()
            .map_err(D::Error::custom)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Validity {
    Good,
    Uncertain,
    Bad,
}

/// Portable quality flags.
pub mod quality_flags {
    pub const STALE: u32 = 1 << 0;
    pub const COMM_FAILURE: u32 = 1 << 1;
    pub const OUT_OF_RANGE: u32 = 1 << 2;
    pub const SUBSTITUTED: u32 = 1 << 3;
    pub const OVERFLOW: u32 = 1 << 4;
}

/// Protocol-native status retained alongside portable quality.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeStatus {
    pub domain: String,
    pub code: String,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointQuality {
    pub validity: Validity,
    pub flags: u32,
    pub native: Option<NativeStatus>,
}

impl PointQuality {
    pub const GOOD: Self = Self {
        validity: Validity::Good,
        flags: 0,
        native: None,
    };

    pub const fn bad(flags: u32, native: NativeStatus) -> Self {
        Self {
            validity: Validity::Bad,
            flags,
            native: Some(native),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointSample {
    pub key: PointKey,
    pub value: Option<PointValue>,
    pub quality: PointQuality,
    pub source_time_unix_ns: Option<i64>,
    pub server_time_unix_ns: Option<i64>,
    pub received_time_unix_ns: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeliveryClass {
    State,
    Event,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointBatch {
    pub delivery: DeliveryClass,
    pub samples: Vec<PointSample>,
}

pub type PointEnvelope = FlowEnvelope<PointBatch>;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PointDataType {
    Bool,
    I16,
    U16,
    I32,
    U32,
    I64,
    U64,
    F32,
    F64,
    Decimal,
    String,
    Bytes,
    DateTime,
    Enum,
    Array,
    Struct,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AccessLevel {
    ReadOnly,
    WriteOnly,
    ReadWrite,
}

/// Driver-owned address retained as structured cold-path data.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeAddress {
    pub domain: String,
    pub value: Value,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointDescriptor {
    pub id: PointId,
    pub path: Vec<String>,
    pub name: String,
    pub data_type: PointDataType,
    pub access: AccessLevel,
    pub engineering_unit: Option<String>,
    pub semantic: BTreeMap<String, String>,
    pub native_address: NativeAddress,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AcquisitionMode {
    Auto,
    Poll,
    Subscribe,
    OnDemand,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Priority {
    Low,
    Normal,
    High,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquisitionIntent {
    pub mode: AcquisitionMode,
    pub requested_period_ms: Option<u64>,
    pub deadband: Option<f64>,
    pub priority: Priority,
    pub delivery: DeliveryClass,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadRequest {
    pub points: Vec<PointId>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub batch: PointEnvelope,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteItem {
    pub point_id: PointId,
    pub value: PointValue,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteRequest {
    pub correlation_id: String,
    pub deadline_unix_ns: i64,
    pub idempotency_key: Option<String>,
    pub items: Vec<WriteItem>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteItemResult {
    pub point_id: PointId,
    pub quality: PointQuality,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub correlation_id: String,
    pub items: Vec<WriteItemResult>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_integers_serialize_as_strings() {
        assert_eq!(
            serde_json::to_value(PointValue::U64(u64::MAX)).unwrap(),
            serde_json::json!({"kind": "u64", "value": "18446744073709551615"})
        );
    }

    #[test]
    fn bad_quality_never_requires_a_fake_value() {
        let sample = PointSample {
            key: PointKey {
                source_id: flow::SourceId::new("plc").unwrap(),
                point_id: PointId("temperature".into()),
            },
            value: None,
            quality: PointQuality::bad(
                quality_flags::COMM_FAILURE,
                NativeStatus {
                    domain: "modbus".into(),
                    code: "gatewayTargetFailed".into(),
                    detail: None,
                },
            ),
            source_time_unix_ns: None,
            server_time_unix_ns: None,
            received_time_unix_ns: 1,
        };
        assert!(sample.value.is_none());
        assert_eq!(sample.quality.validity, Validity::Bad);
    }
}
