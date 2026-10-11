use super::*;

#[test]
fn pack_field_uint_le() {
    assert_eq!(
        pack_field(FieldType::UInt16LE, "0x0102").unwrap(),
        vec![0x02, 0x01]
    );
    assert_eq!(
        pack_field(FieldType::UInt16BE, "0x0102").unwrap(),
        vec![0x01, 0x02]
    );
}

#[test]
fn pack_field_int_le() {
    assert_eq!(
        pack_field(FieldType::Int16LE, "-1").unwrap(),
        vec![0xff, 0xff]
    );
}

/// 回归: Int32 曾漏转 i64→i32, 错误产出 8 字节 (应为 4 字节)
#[test]
fn pack_field_int32_is_four_bytes() {
    assert_eq!(
        pack_field(FieldType::Int32LE, "-2").unwrap(),
        vec![0xfe, 0xff, 0xff, 0xff]
    );
    assert_eq!(
        pack_field(FieldType::Int32BE, "1").unwrap(),
        vec![0x00, 0x00, 0x00, 0x01]
    );
    assert!(pack_field(FieldType::Int32LE, "0x1_0000_0000").is_err());
}

#[test]
fn pack_field_uint8_rejects_overflow() {
    assert!(pack_field(FieldType::UInt8, "256").is_err());
    assert_eq!(pack_field(FieldType::UInt8, "255").unwrap(), vec![0xff]);
    assert_eq!(pack_field(FieldType::Int8, "-128").unwrap(), vec![0x80]);
}

#[test]
fn pack_field_bytes_hex() {
    assert_eq!(
        pack_field(FieldType::Bytes, "AA 01 BB").unwrap(),
        vec![0xaa, 0x01, 0xbb]
    );
}

#[test]
fn parse_hex_odd_len_errors() {
    assert!(parse_hex("AAB").is_err());
}

#[test]
fn concat_chunks_combines() {
    assert_eq!(
        concat_chunks(&[vec![0x01, 0x02], vec![0x03], vec![0x04, 0x05]]),
        vec![0x01, 0x02, 0x03, 0x04, 0x05]
    );
}
