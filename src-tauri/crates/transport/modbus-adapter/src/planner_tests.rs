use super::*;
use crate::{ByteOrder, ModbusDataType, WordOrder};

fn point(id: &str, address: u16, data_type: ModbusDataType) -> ModbusPoint {
    ModbusPoint {
        id: PointId(id.into()),
        area: ModbusArea::HoldingRegisters,
        address,
        data_type,
        byte_order: ByteOrder::Big,
        word_order: WordOrder::Big,
        scale: 1.0,
        offset: 0.0,
        poll_period_ms: 100,
    }
}

#[test]
fn merges_contiguous_registers() {
    let points = [
        point("a", 10, ModbusDataType::U16),
        point("b", 11, ModbusDataType::F32),
    ];
    let plans = plan_reads(&points).unwrap();
    assert_eq!(plans.len(), 1);
    assert_eq!((plans[0].start, plans[0].quantity), (10, 3));
}

#[test]
fn does_not_merge_gaps_or_periods() {
    let mut points = [
        point("a", 10, ModbusDataType::U16),
        point("b", 12, ModbusDataType::U16),
    ];
    points[1].poll_period_ms = 200;
    assert_eq!(plan_reads(&points).unwrap().len(), 2);
}
