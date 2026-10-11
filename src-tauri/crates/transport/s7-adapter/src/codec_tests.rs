use super::*;
use crate::S7Area;
use points::PointId;

fn point(data_type: S7DataType) -> S7Point {
    S7Point {
        id: PointId("p".into()),
        area: S7Area::Db,
        db_number: 10,
        byte_offset: 0,
        bit: 0,
        data_type,
        scale: 1.0,
        offset: 0.0,
        poll_period_ms: 100,
    }
}

#[test]
fn big_endian_roundtrip_for_every_type() {
    let cases: Vec<(S7DataType, PointValue)> = vec![
        (S7DataType::U8, PointValue::U64(0xAB)),
        (S7DataType::I8, PointValue::I64(-3)),
        (S7DataType::U16, PointValue::U64(0x1122)),
        (S7DataType::I16, PointValue::I64(-2)),
        (S7DataType::U32, PointValue::U64(0x1122_3344)),
        (S7DataType::I32, PointValue::I64(-70_589_936)),
        (S7DataType::U64, PointValue::U64(0x1122_3344_5566_7788)),
        (S7DataType::I64, PointValue::I64(-1)),
        (S7DataType::F32, PointValue::F64(f64::from(1.5_f32))),
        (S7DataType::F64, PointValue::F64(2.5)),
    ];
    for (data_type, expected) in cases {
        let point = point(data_type);
        let bytes = encode_point(&point, &expected).unwrap();
        assert_eq!(bytes.len(), usize::from(data_type.byte_size()));
        assert_eq!(decode_point(&point, &bytes).unwrap(), expected);
    }
}

#[test]
fn bool_extracts_the_configured_bit() {
    for bit in 0_u8..8 {
        let mut point = point(S7DataType::Bool);
        point.bit = bit;
        let set = decode_point(&point, &[1 << bit]).unwrap();
        let clear = decode_point(&point, &[!(1 << bit)]).unwrap();
        assert_eq!(set, PointValue::Bool(true));
        assert_eq!(clear, PointValue::Bool(false));
    }
}

#[test]
fn scale_and_offset_apply_in_both_directions() {
    let mut point = point(S7DataType::I16);
    point.scale = 0.5;
    point.offset = 10.0;
    let bytes = encode_point(&point, &PointValue::F64(20.0)).unwrap();
    assert_eq!(decode_point(&point, &bytes).unwrap(), PointValue::F64(20.0));
}
