use crate::config::MAX_BYTE_OFFSET;
use crate::{S7Area, S7DataType, S7Point, SCHEMA_VERSION};
use acquisition::{
    AdapterCapability, AddressRegion, AddressSpaceDescriptor, CAPABILITY_CONTRACT_VERSION,
    CapabilitySet, ConfigurationSchema, DisplaySemantics, DriverManifest, EndpointDescriptor,
    EndpointDirection, PortDescriptor, PortDirection, ProtocolKind, RuntimeState, RuntimeStatus,
    TransportKind,
};
use flow::PayloadKind;
use points::{AccessLevel, NativeAddress, PointDataType, PointDescriptor};
use std::collections::{BTreeMap, BTreeSet};

pub fn capability_set() -> CapabilitySet {
    CapabilitySet {
        read: true,
        subscribe: true,
        write: true,
        ..CapabilitySet::default()
    }
}

pub fn adapter_capability(manifest: &DriverManifest) -> AdapterCapability {
    let operations = manifest.capabilities;
    let display = DisplaySemantics {
        category: Some("industrial-control".into()),
        symbol: Some("plc".into()),
        tags: BTreeSet::from(["polling".into(), "request-response".into()]),
    };
    AdapterCapability {
        contract_version: CAPABILITY_CONTRACT_VERSION,
        adapter_id: manifest.id.clone(),
        display_name: manifest.display_name.clone(),
        protocol: ProtocolKind::S7,
        transport: TransportKind::Tcp,
        direction: EndpointDirection::Client,
        operations,
        data_domains: manifest.payload_kinds.clone(),
        endpoints: vec![EndpointDescriptor {
            id: "client".into(),
            display_name: "Siemens S7 device".into(),
            transport: TransportKind::Tcp,
            direction: EndpointDirection::Client,
            status: RuntimeStatus {
                state: RuntimeState::Available,
                detail: None,
            },
            ports: vec![point_port(operations)],
            configuration: configuration_schema(),
            display: Some(display.clone()),
        }],
        display: Some(display),
    }
}

pub fn configuration_schema() -> ConfigurationSchema {
    ConfigurationSchema {
        schema_version: SCHEMA_VERSION,
        json_schema: schema(),
        ui_hints: serde_json::json!({
            "host": {"order": 0, "group": "connection"},
            "port": {"order": 1, "group": "connection"},
            "plcType": {"order": 2, "group": "protocol"},
            "rack": {"order": 3, "group": "protocol"},
            "slot": {"order": 4, "group": "protocol"},
            "timeoutMs": {"order": 5, "group": "connection", "unit": "ms"},
            "reconnect": {"order": 6, "group": "reliability"},
            "points": {"order": 7, "group": "points"}
        }),
    }
}

fn point_port(operations: CapabilitySet) -> PortDescriptor {
    PortDescriptor {
        id: "points".into(),
        display_name: "S7 data points".into(),
        direction: PortDirection::Bidirectional,
        data_domain: PayloadKind::Points,
        operations,
        address_space: Some(AddressSpaceDescriptor {
            unit: "byte-address-with-bit-offset".into(),
            regions: vec![
                address_region("inputs", "I (inputs)", false),
                address_region("outputs", "Q (outputs)", true),
                address_region("markers", "M (markers)", true),
                address_region("db", "DB (data blocks)", true),
            ],
        }),
        data_types: BTreeSet::from([
            "bool".into(),
            "u8".into(),
            "i8".into(),
            "u16".into(),
            "i16".into(),
            "u32".into(),
            "i32".into(),
            "u64".into(),
            "i64".into(),
            "f32".into(),
            "f64".into(),
        ]),
        display: Some(DisplaySemantics {
            category: Some("telemetry".into()),
            symbol: Some("plc".into()),
            tags: BTreeSet::from(["state".into(), "command".into()]),
        }),
    }
}

fn address_region(id: &str, display_name: &str, writable: bool) -> AddressRegion {
    AddressRegion {
        id: id.into(),
        display_name: display_name.into(),
        minimum: 0,
        maximum: u64::from(MAX_BYTE_OFFSET),
        readable: true,
        writable,
    }
}

/// 8-bit values widen to the closest rich point type; the projected
/// `PointValue` itself stays lossless (`U64`/`I64`).
const fn point_data_type(data_type: S7DataType) -> PointDataType {
    match data_type {
        S7DataType::Bool => PointDataType::Bool,
        S7DataType::U8 => PointDataType::U16,
        S7DataType::I8 => PointDataType::I16,
        S7DataType::U16 => PointDataType::U16,
        S7DataType::I16 => PointDataType::I16,
        S7DataType::U32 => PointDataType::U32,
        S7DataType::I32 => PointDataType::I32,
        S7DataType::U64 => PointDataType::U64,
        S7DataType::I64 => PointDataType::I64,
        S7DataType::F32 => PointDataType::F32,
        S7DataType::F64 => PointDataType::F64,
    }
}

pub fn point_descriptor(point: &S7Point) -> PointDescriptor {
    PointDescriptor {
        id: point.id.clone(),
        path: vec![native_label(point)],
        name: point.id.0.clone(),
        data_type: point_data_type(point.data_type),
        access: if point.area.writable() {
            AccessLevel::ReadWrite
        } else {
            AccessLevel::ReadOnly
        },
        engineering_unit: None,
        semantic: BTreeMap::new(),
        native_address: NativeAddress {
            domain: "s7".into(),
            value: serde_json::json!({
                "area": point.area,
                "dbNumber": point.db_number,
                "byteOffset": point.byte_offset,
                "bit": point.bit,
            }),
        },
    }
}

/// Compact S7-notation label (e.g. `DB10.DBX5.3`, `M1.2`, `DB10.DBB4`).
pub fn native_label(point: &S7Point) -> String {
    let is_bool = point.data_type == S7DataType::Bool;
    match point.area {
        S7Area::Db if is_bool => format!(
            "DB{}.DBX{}.{}",
            point.db_number, point.byte_offset, point.bit
        ),
        S7Area::Db => format!("DB{}.DBB{}", point.db_number, point.byte_offset),
        area if is_bool => format!("{}{}.{}", area_prefix(area), point.byte_offset, point.bit),
        area => format!("{}{}", area_prefix(area), point.byte_offset),
    }
}

const fn area_prefix(area: S7Area) -> &'static str {
    match area {
        S7Area::Inputs => "I",
        S7Area::Outputs => "Q",
        S7Area::Markers => "M",
        S7Area::Db => "DB",
    }
}

fn schema() -> serde_json::Value {
    serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://lissio.app/schemas/adapters/s7/v1",
        "title": "Siemens S7 client",
        "type": "object",
        "required": ["host", "points"],
        "additionalProperties": true,
        "properties": {
            "host": {"type": "string", "minLength": 1, "default": "127.0.0.1",
                "description": "PLC IP address or hostname (port 102)"},
            "port": {"type": "integer", "minimum": 1, "maximum": 65535, "default": 102},
            "plcType": {"type": "string", "enum": ["s200", "s200Smart", "s300", "s400", "s1200", "s1500"], "default": "s1200"},
            "rack": {"type": "integer", "minimum": 0, "maximum": 7, "default": 0},
            "slot": {"type": "integer", "minimum": 0, "maximum": 31, "default": 1},
            "timeoutMs": {"type": "integer", "minimum": 1, "default": 2000},
            "reconnect": {
                "type": "object",
                "additionalProperties": true,
                "properties": {
                    "maxAttempts": {"type": "integer", "minimum": 0, "default": 3},
                    "initialDelayMs": {"type": "integer", "minimum": 0, "default": 100},
                    "maxDelayMs": {"type": "integer", "minimum": 0, "default": 2000}
                }
            },
            "points": {
                "type": "array",
                "default": [],
                "items": {
                    "type": "object",
                    "required": ["id", "area", "byteOffset", "dataType"],
                    "additionalProperties": true,
                    "properties": {
                        "id": {"type": "string", "minLength": 1},
                        "area": {"type": "string", "enum": ["inputs", "outputs", "markers", "db"]},
                        "dbNumber": {"type": "integer", "minimum": 1, "maximum": 65535},
                        "byteOffset": {"type": "integer", "minimum": 0, "maximum": 2097151},
                        "bit": {"type": "integer", "minimum": 0, "maximum": 7, "default": 0},
                        "dataType": {"type": "string", "enum": ["bool", "u8", "i8", "u16", "i16", "u32", "i32", "u64", "i64", "f32", "f64"]},
                        "scale": {"type": "number", "default": 1},
                        "offset": {"type": "number", "default": 0},
                        "pollPeriodMs": {"type": "integer", "minimum": 1, "default": 1000}
                    }
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::S7PlcType;
    use crate::{S7Area, S7DataType};
    use points::PointId;

    #[test]
    fn inputs_are_read_only_and_plc_types_round_trip() {
        let region = |id: &str| {
            let port = point_port(CapabilitySet::default());
            port.address_space
                .unwrap()
                .regions
                .into_iter()
                .find(|region| region.id == id)
                .unwrap()
        };
        assert!(!region("inputs").writable);
        assert!(region("outputs").writable);
        assert!(region("markers").writable);
        assert!(region("db").writable);
        assert_eq!(
            S7PlcType::default().to_sdk(),
            tokio_s7::types::PlcType::S1200
        );
    }

    #[test]
    fn native_addresses_carry_the_full_s7_address() {
        let point = S7Point {
            id: PointId("p".into()),
            area: S7Area::Db,
            db_number: 10,
            byte_offset: 5,
            bit: 3,
            data_type: S7DataType::Bool,
            scale: 1.0,
            offset: 0.0,
            poll_period_ms: 100,
        };
        let descriptor = point_descriptor(&point);
        assert_eq!(descriptor.access, AccessLevel::ReadWrite);
        assert_eq!(descriptor.data_type, PointDataType::Bool);
        assert_eq!(
            descriptor.native_address.value["dbNumber"],
            serde_json::json!(10)
        );
        assert_eq!(native_label(&point), "DB10.DBX5.3");
    }
}
