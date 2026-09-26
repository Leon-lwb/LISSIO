//! `can::can_buffer` 单元测试

use can::{CanBuffer, CanCursor, CanDirection, CanFrame};

const fn mk_frame(ts: u64, id: u32) -> CanFrame {
    CanFrame {
        timestamp: ts,
        id,
        extended: false,
        rtr: false,
        dlc: 0,
        data: Vec::new(),
        direction: CanDirection::Rx,
    }
}

#[test]
fn new_buffer_is_empty() {
    let buf = CanBuffer::new(10);
    assert!(buf.is_empty());
    assert_eq!(buf.len(), 0);
    assert_eq!(buf.version(), 0);
    assert_eq!(buf.capacity(), 10);
}

#[test]
fn push_increments_version() {
    let mut buf = CanBuffer::new(5);
    buf.push(mk_frame(1, 0x100));
    assert_eq!(buf.version(), 1);
    buf.push(mk_frame(2, 0x101));
    assert_eq!(buf.version(), 2);
}

#[test]
fn push_past_capacity_drops_oldest() {
    let mut buf = CanBuffer::new(3);
    buf.push(mk_frame(1, 1));
    buf.push(mk_frame(2, 2));
    buf.push(mk_frame(3, 3));
    buf.push(mk_frame(4, 4));
    assert_eq!(buf.len(), 3);
    let frames = buf.get_recent(10);
    assert_eq!(
        frames.iter().map(|f| f.id).collect::<Vec<_>>(),
        vec![2, 3, 4]
    );
}

#[test]
fn get_recent_returns_in_time_order() {
    let mut buf = CanBuffer::new(10);
    for i in 0..5u32 {
        buf.push(mk_frame(u64::from(i), i));
    }
    let recent = buf.get_recent(3);
    assert_eq!(recent.len(), 3);
    assert_eq!(recent[0].id, 2);
    assert_eq!(recent[1].id, 3);
    assert_eq!(recent[2].id, 4);
}

#[test]
fn read_from_advances_cursor() {
    let mut buf = CanBuffer::new(10);
    for i in 0..5u32 {
        buf.push(mk_frame(u64::from(i), i));
    }
    let first = buf.read_from(CanCursor::new(0), 3);
    assert_eq!(first.frames.len(), 3);
    assert_eq!(first.frames[0].id, 0);
    assert_eq!(first.next_cursor.value(), 3);
    assert_eq!(first.dropped, 0);

    let second = buf.read_from(first.next_cursor, 3);
    assert_eq!(second.frames.len(), 2);
    assert_eq!(second.next_cursor.value(), 5);
    assert_eq!(second.dropped, 0);
}

#[test]
fn read_from_never_replays_caught_up_cursor() {
    let mut buf = CanBuffer::new(10);
    for i in 0..3u32 {
        buf.push(mk_frame(u64::from(i), i));
    }
    let result = buf.read_from(CanCursor::new(10), 5);
    assert!(result.frames.is_empty(), "追平后的游标不能重复返回快照");
    assert_eq!(result.next_cursor.value(), 10);
    assert_eq!(result.dropped, 0);
}

#[test]
fn clear_keeps_version_monotonic() {
    let mut buf = CanBuffer::new(5);
    buf.push(mk_frame(1, 1));
    buf.push(mk_frame(2, 2));
    let v_before = buf.version();
    buf.clear();
    assert!(buf.is_empty());
    assert!(buf.version() > v_before, "版本号必须继续递增避免订阅漏数据");
}

#[test]
fn set_max_size_shrinks_buffer() {
    let mut buf = CanBuffer::new(10);
    for i in 0..8u32 {
        buf.push(mk_frame(u64::from(i), i));
    }
    buf.set_max_size(3);
    assert_eq!(buf.capacity(), 3);
    assert_eq!(buf.len(), 3);
}

#[test]
fn set_max_size_minimum_one() {
    let mut buf = CanBuffer::new(5);
    buf.set_max_size(0);
    assert_eq!(buf.capacity(), 1);
}

#[test]
fn capacity_at_least_one_when_constructed_with_zero() {
    let buf = CanBuffer::new(0);
    assert_eq!(buf.capacity(), 1, "capacity 必须至少为 1");
}

#[test]
fn read_from_reports_evicted_history_without_replaying_it() {
    let mut buf = CanBuffer::new(2);
    for id in 0..4u32 {
        buf.push(mk_frame(u64::from(id), id));
    }
    let result = buf.read_from(CanCursor::new(0), 10);
    assert_eq!(
        result.frames.iter().map(|f| f.id).collect::<Vec<_>>(),
        vec![2, 3]
    );
    assert_eq!(result.dropped, 2);
    assert_eq!(result.next_cursor.value(), 4);
    assert!(buf.read_from(result.next_cursor, 10).frames.is_empty());
}
