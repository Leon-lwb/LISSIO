use super::RingBuffer;

#[test]
fn logical_get_follows_time_order_after_wrap() {
    let mut buffer = RingBuffer::new(3);
    buffer.extend(&[1, 2, 3, 4]);

    assert_eq!(buffer.get(0), Some(&2));
    assert_eq!(buffer.get(1), Some(&3));
    assert_eq!(buffer.get(2), Some(&4));
    assert_eq!(buffer.get(3), None);
}
