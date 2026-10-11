use super::decode_reg_string;

#[test]
fn registry_strings_support_localized_names_and_reject_invalid_data() {
    let bytes: Vec<u8> = "串口 (COM3)\0"
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    assert_eq!(decode_reg_string(&bytes).as_deref(), Some("串口 (COM3)"));
    assert_eq!(decode_reg_string(&[0]), None);
    assert_eq!(decode_reg_string(&[0, 0xd8]), None);
    assert_eq!(decode_reg_string(&[0, 0]), None);
}
