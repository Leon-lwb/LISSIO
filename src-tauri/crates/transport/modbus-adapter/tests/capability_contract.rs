use acquisition::{
    CAPABILITY_CONTRACT_VERSION, EndpointDirection, PortDirection, ProtocolKind, RuntimeState,
    SourceFactory, TransportKind,
};
use data_model::device::{DriverId, DriverPayload};
use flow::PayloadKind;
use modbus_adapter::{DRIVER_ID, ModbusFactory, ModbusRtuFactory, RTU_DRIVER_ID, SCHEMA_VERSION};
use serde_json::json;

#[test]
fn published_capability_matches_the_implemented_tcp_client() {
    let factory = ModbusFactory::default();
    let capability = factory.adapter_capability();
    assert_eq!(capability.contract_version, CAPABILITY_CONTRACT_VERSION);
    assert_eq!(capability.adapter_id.0, DRIVER_ID);
    assert_eq!(capability.protocol, ProtocolKind::ModbusTcp);
    assert_eq!(capability.transport, TransportKind::Tcp);
    assert_eq!(capability.direction, EndpointDirection::Client);
    assert_eq!(capability.data_domains, [PayloadKind::Points].into());
    assert!(capability.operations.read);
    assert!(capability.operations.subscribe);
    assert!(capability.operations.write);
    assert!(!capability.operations.discover);

    let endpoint = &capability.endpoints[0];
    assert_eq!(endpoint.status.state, RuntimeState::Available);
    assert_eq!(endpoint.configuration.schema_version, SCHEMA_VERSION);
    let port = &endpoint.ports[0];
    assert_eq!(port.direction, PortDirection::Bidirectional);
    assert_eq!(port.data_domain, PayloadKind::Points);
    let regions = &port.address_space.as_ref().unwrap().regions;
    assert_eq!(regions.len(), 4);
    assert!(
        !regions
            .iter()
            .find(|region| region.id == "inputRegisters")
            .unwrap()
            .writable
    );
    assert!(
        regions
            .iter()
            .find(|region| region.id == "holdingRegisters")
            .unwrap()
            .writable
    );
}

#[test]
fn published_rtu_capability_exposes_serial_discovery_and_schema() {
    let capability = ModbusRtuFactory::default().adapter_capability();
    assert_eq!(capability.adapter_id.0, RTU_DRIVER_ID);
    assert_eq!(capability.protocol, ProtocolKind::ModbusRtu);
    assert_eq!(capability.transport, TransportKind::Serial);
    assert!(capability.operations.discover);
    let schema = &capability.endpoints[0].configuration.json_schema;
    assert_eq!(schema["required"], json!(["portName", "points"]));
    assert_eq!(schema["properties"]["baudRate"]["default"], 9600);
    assert_eq!(schema["properties"]["parity"]["default"], "none");
    assert!(schema["properties"].get("host").is_none());
}

#[test]
fn capability_wire_shape_is_versioned_and_renderer_neutral() {
    let value = serde_json::to_value(ModbusFactory::default().adapter_capability()).unwrap();
    assert_eq!(value["contractVersion"], 1);
    assert_eq!(value["protocol"], "modbus-tcp");
    assert_eq!(value["transport"], "tcp");
    assert_eq!(value["endpoints"][0]["ports"][0]["dataDomain"], "points");
    let text = value.to_string();
    assert!(!text.contains("ModbusFactory"));
    assert!(!text.contains("DeviceCard"));
}

#[test]
fn only_the_current_schema_is_accepted() {
    let factory = ModbusFactory::default();
    let old = DriverPayload {
        driver_id: DriverId(DRIVER_ID.into()),
        schema_version: 0,
        payload: json!({
            "host": "127.0.0.1",
            "points": [],
            "vendorExtension": {"keep": true}
        }),
    };
    assert!(
        factory
            .validate(&old)
            .err()
            .expect("schema 0 must fail")
            .to_string()
            .contains("schema version")
    );
}

#[test]
fn future_schema_versions_are_rejected_without_mutation() {
    let factory = ModbusFactory::default();
    let future = DriverPayload {
        driver_id: DriverId(DRIVER_ID.into()),
        schema_version: SCHEMA_VERSION + 1,
        payload: json!({"host": "example", "points": []}),
    };
    assert!(
        factory
            .validate(&future)
            .err()
            .expect("future schema must fail")
            .to_string()
            .contains("schema version")
    );
}
