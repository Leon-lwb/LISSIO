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
