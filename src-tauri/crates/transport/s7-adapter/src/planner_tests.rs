use super::*;
use crate::S7DataType;
use points::PointId;

fn point(id: &str, area: S7Area, db_number: u16, byte_offset: u32, size: S7DataType) -> S7Point {
    S7Point {
        id: PointId(id.into()),
        area,
        db_number,
        byte_offset,
        bit: 0,
        data_type: size,
        scale: 1.0,
        offset: 0.0,
        poll_period_ms: 100,
    }
}

#[test]
fn merges_contiguous_bytes_within_the_same_block() {
    let points = [
        point("a", S7Area::Db, 10, 0, S7DataType::U16),
        point("b", S7Area::Db, 10, 2, S7DataType::F32),
    ];
    let plans = plan_reads(&points, 200).unwrap();
    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].start, 0);
    assert_eq!(plans[0].byte_count, 6);
    assert_eq!(plans[0].points[1].offset, 2);
}

#[test]
fn splits_on_area_db_gap_and_period() {
    let mut points = [
        point("a", S7Area::Db, 10, 0, S7DataType::U16),
        point("b", S7Area::Db, 10, 2, S7DataType::U16),
        point("c", S7Area::Markers, 0, 4, S7DataType::U16),
        point("d", S7Area::Db, 11, 6, S7DataType::U16),
    ];
    points[1].poll_period_ms = 200;
    points[2].byte_offset = 100;
    let plans = plan_reads(&points, 200).unwrap();
    assert_eq!(plans.len(), 4);
}

#[test]
fn respects_the_read_budget() {
    let points = [
        point("a", S7Area::Db, 10, 0, S7DataType::U16),
        point("b", S7Area::Db, 10, 2, S7DataType::U16),
    ];
    let plans = plan_reads(&points, 2).unwrap();
    assert_eq!(plans.len(), 2);
}

#[test]
fn bools_share_their_containing_byte() {
    let mut a = point("a", S7Area::Markers, 0, 1, S7DataType::Bool);
    let mut b = point("b", S7Area::Markers, 0, 1, S7DataType::Bool);
    a.bit = 2;
    b.bit = 5;
    let plans = plan_reads(&[a, b], 200).unwrap();
    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].byte_count, 1);
}
