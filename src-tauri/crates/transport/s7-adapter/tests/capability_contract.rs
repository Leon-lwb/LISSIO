use acquisition::{
    CAPABILITY_CONTRACT_VERSION, EndpointDirection, PortDirection, ProtocolKind, RuntimeState,
    SourceFactory, TransportKind,
};
use data_model::device::{DriverId, DriverPayload};
use flow::PayloadKind;
use s7_adapter::{DRIVER_ID, S7Factory, SCHEMA_VERSION};
use serde_json::json;

#[test]
fn published_capability_matches_the_implemented_tcp_client() {
    let factory = S7Factory::default();
    let capability = factory.adapter_capability();
    assert_eq!(capability.contract_version, CAPABILITY_CONTRACT_VERSION);
    assert_eq!(capability.adapter_id.0, DRIVER_ID);
    assert_eq!(capability.protocol, ProtocolKind::S7);
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
            .find(|region| region.id == "inputs")
            .unwrap()
            .writable
    );
    for writable_region in ["outputs", "markers", "db"] {
        assert!(
            regions
                .iter()
                .find(|region| region.id == writable_region)
                .unwrap()
                .writable
        );
    }
}

#[test]
fn capability_wire_shape_is_versioned_and_renderer_neutral() {
    let value = serde_json::to_value(S7Factory::default().adapter_capability()).unwrap();
    assert_eq!(value["contractVersion"], 1);
    assert_eq!(value["protocol"], "s7");
    assert_eq!(value["transport"], "tcp");
    assert_eq!(value["endpoints"][0]["ports"][0]["dataDomain"], "points");
    let text = value.to_string();
    assert!(!text.contains("S7Factory"));
    assert!(!text.contains("DeviceCard"));
}

#[test]
fn schema_documents_plc_addressing() {
    let schema = S7Factory::default().config_schema().json_schema;
    assert_eq!(schema["required"], json!(["host", "points"]));
    assert_eq!(schema["properties"]["port"]["default"], 102);
    assert_eq!(schema["properties"]["rack"]["maximum"], 7);
    assert_eq!(schema["properties"]["slot"]["maximum"], 31);
    let points = &schema["properties"]["points"]["items"]["properties"];
    assert_eq!(
        points["area"]["enum"],
        json!(["inputs", "outputs", "markers", "db"])
    );
    assert_eq!(points["byteOffset"]["maximum"], 2_097_151);
}

#[test]
fn only_the_current_schema_is_accepted() {
    let factory = S7Factory::default();
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
fn mismatched_driver_ids_are_rejected() {
    let factory = S7Factory::default();
    let foreign = DriverPayload {
        driver_id: DriverId("modbus-tcp".into()),
        schema_version: SCHEMA_VERSION,
        payload: json!({"host": "127.0.0.1", "points": []}),
    };
    assert!(factory.validate(&foreign).is_err());
}

#[test]
fn invalid_plc_configurations_are_rejected_before_open() {
    let factory = S7Factory::default();
    let cases = vec![
        // bit offset on a non-bool point
        json!({
            "host": "127.0.0.1",
            "points": [{"id": "w", "area": "markers", "byteOffset": 0,
                        "bit": 3, "dataType": "u16"}]
        }),
        // dbNumber on a non-db area
        json!({
            "host": "127.0.0.1",
            "points": [{"id": "m", "area": "markers", "dbNumber": 1,
                        "byteOffset": 0, "dataType": "u16"}]
        }),
        // duplicate ids
        json!({
            "host": "127.0.0.1",
            "points": [
                {"id": "a", "area": "markers", "byteOffset": 0, "dataType": "u8"},
                {"id": "a", "area": "markers", "byteOffset": 1, "dataType": "u8"}
            ]
        }),
        // rack beyond 3 bits
        json!({"host": "127.0.0.1", "rack": 8, "points": []}),
    ];
    for payload in cases {
        let payload = DriverPayload {
            driver_id: DriverId(DRIVER_ID.into()),
            schema_version: SCHEMA_VERSION,
            payload,
        };
        assert!(
            factory.validate(&payload).is_err(),
            "configuration must be rejected: {payload:?}"
        );
    }
}
