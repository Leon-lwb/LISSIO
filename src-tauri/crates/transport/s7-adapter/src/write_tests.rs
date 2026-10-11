use super::*;
use crate::{S7Area, S7DataType};
use points::PointId;

fn point(data_type: S7DataType) -> S7Point {
    S7Point {
        id: PointId("p".into()),
        area: S7Area::Markers,
        db_number: 0,
        byte_offset: 4,
        bit: 3,
        data_type,
        scale: 1.0,
        offset: 0.0,
        poll_period_ms: 100,
    }
}

#[test]
fn bool_writes_use_the_bit_transport_at_the_bit_address() {
    let (item, data) =
        build_request(&point(S7DataType::Bool), &PointValue::Bool(true)).expect("bool request");
    assert_eq!(item.variable_type, S7ParamVariableType::Bit);
    assert_eq!(item.count, 1);
    assert_eq!(item.byte_address, 4);
    assert_eq!(item.bit_address, 3);
    assert_eq!(item.area, tokio_s7::types::S7Area::Flags);
    assert_eq!(
        data.data_variable_type,
        tokio_s7::types::S7DataVariableType::Bit
    );
    assert_eq!(data.count, 1);
    assert_eq!(data.data, vec![0x01]);
}

#[test]
fn numeric_writes_use_the_byte_transport_with_be_bytes() {
    let mut word = point(S7DataType::U16);
    word.bit = 0;
    let (item, data) = build_request(&word, &PointValue::U64(0x1234)).expect("numeric request");
    assert_eq!(item.variable_type, S7ParamVariableType::Byte);
    assert_eq!(item.count, 2);
    assert_eq!(item.bit_address, 0);
    assert_eq!(data.data, vec![0x12, 0x34]);
    assert_eq!(
        data.data_variable_type,
        tokio_s7::types::S7DataVariableType::ByteWordDword
    );
}

#[test]
fn non_bool_values_are_rejected_for_bool_points() {
    let error = build_request(&point(S7DataType::Bool), &PointValue::U64(1)).expect_err("mismatch");
    assert_eq!(error.code, "typeMismatch");
    assert!(!error.disconnect);
}
