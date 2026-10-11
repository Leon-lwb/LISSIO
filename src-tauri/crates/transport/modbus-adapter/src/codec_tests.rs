use super::*;
use crate::ModbusArea;
use points::PointId;

fn point(byte_order: ByteOrder, word_order: WordOrder) -> ModbusPoint {
    ModbusPoint {
        id: PointId("p".into()),
        area: ModbusArea::HoldingRegisters,
        address: 0,
        data_type: ModbusDataType::U32,
        byte_order,
        word_order,
        scale: 1.0,
        offset: 0.0,
        poll_period_ms: 100,
    }
}

#[test]
fn byte_and_word_order_are_explicit_and_reversible() {
    let expected = PointValue::U64(0x1122_3344);
    for byte in [ByteOrder::Big, ByteOrder::Little] {
        for word in [WordOrder::Big, WordOrder::Little] {
            let point = point(byte, word);
            let registers = encode_registers(&point, &expected).unwrap();
            assert_eq!(decode_registers(&point, &registers).unwrap(), expected);
        }
    }
}
