use crate::{ModbusPoint, SCHEMA_VERSION};
use acquisition::{
    AdapterCapability, AddressRegion, AddressSpaceDescriptor, CapabilitySet, ConfigurationSchema,
    DisplaySemantics, DriverManifest, EndpointDescriptor, EndpointDirection, PortDescriptor,
    PortDirection, ProtocolKind, RuntimeState, RuntimeStatus, TransportKind,
    CAPABILITY_CONTRACT_VERSION,
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

pub fn rtu_capability_set() -> CapabilitySet {
    CapabilitySet {
        discover: true,
        ..capability_set()
    }
}

pub fn tcp_adapter_capability(manifest: &DriverManifest) -> AdapterCapability {
    adapter_capability(
        manifest,
        ProtocolKind::ModbusTcp,
        TransportKind::Tcp,
        "client",
        "Modbus TCP device",
        tcp_configuration_schema(),
    )
}

pub fn rtu_adapter_capability(manifest: &DriverManifest) -> AdapterCapability {
    adapter_capability(
        manifest,
        ProtocolKind::ModbusRtu,
        TransportKind::Serial,
        "serial-client",
        "Modbus RTU device",
        rtu_configuration_schema(),
    )
}

fn adapter_capability(
    manifest: &DriverManifest,
    protocol: ProtocolKind,
    transport: TransportKind,
    endpoint_id: &str,
    endpoint_name: &str,
    configuration: ConfigurationSchema,
) -> AdapterCapability {
    let operations = manifest.capabilities;
    let display = DisplaySemantics {
        category: Some("industrial-control".into()),
        symbol: Some("registers".into()),
        tags: BTreeSet::from(["polling".into(), "request-response".into()]),
    };
    AdapterCapability {
        contract_version: CAPABILITY_CONTRACT_VERSION,
        adapter_id: manifest.id.clone(),
        display_name: manifest.display_name.clone(),
        protocol,
        transport,
        direction: EndpointDirection::Client,
        operations,
        data_domains: manifest.payload_kinds.clone(),
        endpoints: vec![EndpointDescriptor {
            id: endpoint_id.into(),
            display_name: endpoint_name.into(),
            transport,
            direction: EndpointDirection::Client,
            status: RuntimeStatus {
                state: RuntimeState::Available,
                detail: None,
            },
            ports: vec![point_port(operations)],
            configuration,
            display: Some(display.clone()),
        }],
        display: Some(display),
    }
}

pub fn tcp_configuration_schema() -> ConfigurationSchema {
    ConfigurationSchema {
        schema_version: SCHEMA_VERSION,
        json_schema: tcp_schema(),
        ui_hints: serde_json::json!({
            "host": {"order": 0, "group": "connection"},
            "port": {"order": 1, "group": "connection"},
            "unitId": {"order": 2, "group": "protocol"},
            "timeoutMs": {"order": 3, "group": "connection", "unit": "ms"},
            "reconnect": {"order": 4, "group": "reliability"},
            "points": {"order": 5, "group": "points"}
        }),
    }
}

pub fn rtu_configuration_schema() -> ConfigurationSchema {
    ConfigurationSchema {
        schema_version: SCHEMA_VERSION,
        json_schema: rtu_schema(),
        ui_hints: serde_json::json!({
            "portName": {"order": 0, "group": "connection", "control": "serial-port"},
            "baudRate": {"order": 1, "group": "connection"},
            "dataBits": {"order": 2, "group": "serial"},
            "parity": {"order": 3, "group": "serial"},
            "stopBits": {"order": 4, "group": "serial"},
            "flowControl": {"order": 5, "group": "serial"},
            "unitId": {"order": 6, "group": "protocol"},
            "timeoutMs": {"order": 7, "group": "reliability", "unit": "ms"},
            "reconnect": {"order": 8, "group": "reliability"},
            "points": {"order": 9, "group": "points"}
        }),
    }
}

fn point_port(operations: CapabilitySet) -> PortDescriptor {
    PortDescriptor {
        id: "points".into(),
        display_name: "Modbus data points".into(),
        direction: PortDirection::Bidirectional,
        data_domain: PayloadKind::Points,
        operations,
        address_space: Some(AddressSpaceDescriptor {
            unit: "zero-based-address".into(),
            regions: vec![
                address_region("coils", "Coils", true),
                address_region("discreteInputs", "Discrete inputs", false),
                address_region("inputRegisters", "Input registers", false),
                address_region("holdingRegisters", "Holding registers", true),
            ],
        }),
        data_types: BTreeSet::from([
            "bool".into(),
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
            symbol: Some("registers".into()),
            tags: BTreeSet::from(["state".into(), "command".into()]),
        }),
    }
}

fn address_region(id: &str, display_name: &str, writable: bool) -> AddressRegion {
    AddressRegion {
        id: id.into(),
        display_name: display_name.into(),
        minimum: 0,
        maximum: u64::from(u16::MAX),
        readable: true,
        writable,
    }
}

pub fn point_descriptor(point: &ModbusPoint) -> PointDescriptor {
    let data_type = match point.data_type {
        crate::ModbusDataType::Bool => PointDataType::Bool,
        crate::ModbusDataType::U16 => PointDataType::U16,
        crate::ModbusDataType::I16 => PointDataType::I16,
        crate::ModbusDataType::U32 => PointDataType::U32,
        crate::ModbusDataType::I32 => PointDataType::I32,
        crate::ModbusDataType::U64 => PointDataType::U64,
        crate::ModbusDataType::I64 => PointDataType::I64,
        crate::ModbusDataType::F32 => PointDataType::F32,
        crate::ModbusDataType::F64 => PointDataType::F64,
    };
    PointDescriptor {
        id: point.id.clone(),
        path: vec![format!("{:?}", point.area)],
        name: point.id.0.clone(),
        data_type,
        access: if point.area.writable() {
            AccessLevel::ReadWrite
        } else {
            AccessLevel::ReadOnly
        },
        engineering_unit: None,
        semantic: BTreeMap::new(),
        native_address: NativeAddress {
            domain: "modbus".into(),
            value: serde_json::json!({"area": point.area, "address": point.address}),
        },
    }
}

fn tcp_schema() -> serde_json::Value {
    serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://lissio.app/schemas/adapters/modbus-tcp/v1",
        "title": "Modbus TCP client",
        "type": "object",
        "required": ["host", "points"],
        "additionalProperties": true,
        "properties": {
            "host": {"type": "string", "minLength": 1, "default": "127.0.0.1"},
            "port": {"type": "integer", "minimum": 1, "maximum": 65535, "default": 502},
            "unitId": {"type": "integer", "minimum": 0, "maximum": 255, "default": 1},
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
                    "required": ["id", "area", "address", "dataType"],
                    "additionalProperties": true,
                    "properties": {
                        "id": {"type": "string", "minLength": 1},
                        "area": {"type": "string", "enum": ["coils", "discreteInputs", "inputRegisters", "holdingRegisters"]},
                        "address": {"type": "integer", "minimum": 0, "maximum": 65535},
                        "dataType": {"type": "string", "enum": ["bool", "u16", "i16", "u32", "i32", "u64", "i64", "f32", "f64"]},
                        "byteOrder": {"type": "string", "enum": ["big", "little"], "default": "big"},
                        "wordOrder": {"type": "string", "enum": ["big", "little"], "default": "big"},
                        "scale": {"type": "number", "default": 1},
                        "offset": {"type": "number", "default": 0},
                        "pollPeriodMs": {"type": "integer", "minimum": 1, "default": 1000}
                    }
                }
            }
        }
    })
}

fn rtu_schema() -> serde_json::Value {
    let mut schema = tcp_schema();
    let object = schema.as_object_mut().expect("schema is an object");
    object.insert(
        "$id".into(),
        serde_json::json!("https://lissio.app/schemas/adapters/modbus-rtu/v1"),
    );
    object.insert("title".into(), serde_json::json!("Modbus RTU client"));
    object.insert("required".into(), serde_json::json!(["portName", "points"]));
    let properties = object["properties"]
        .as_object_mut()
        .expect("properties is an object");
    properties.remove("host");
    properties.remove("port");
    properties.insert(
        "portName".into(),
        serde_json::json!({"type": "string", "minLength": 1}),
    );
    properties.insert(
        "baudRate".into(),
        serde_json::json!({"type": "integer", "minimum": 1, "default": 9600}),
    );
    properties.insert(
        "dataBits".into(),
        serde_json::json!({"type": "string", "enum": ["seven", "eight"], "default": "eight"}),
    );
    properties.insert(
        "parity".into(),
        serde_json::json!({"type": "string", "enum": ["none", "odd", "even"], "default": "none"}),
    );
    properties.insert(
        "stopBits".into(),
        serde_json::json!({"type": "string", "enum": ["one", "two"], "default": "one"}),
    );
    properties.insert(
        "flowControl".into(),
        serde_json::json!({"type": "string", "enum": ["none", "software", "hardware"], "default": "none"}),
    );
    schema
}
