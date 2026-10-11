use super::*;

/// hex 编码: 空格分隔大写, 空输入为空串。
#[test]
fn hex_encode_formats_bytes() {
    assert_eq!(hex_encode(&[]), "");
    assert_eq!(hex_encode(&[0x00, 0xAA, 0xFF]), "00 AA FF");
}

/// 调用 id 唯一且带 fe- 前缀。
#[test]
fn call_ids_are_unique() {
    let a = next_call_id();
    let b = next_call_id();
    assert_ne!(a, b);
    assert!(a.starts_with("fe-") && b.starts_with("fe-"));
}
