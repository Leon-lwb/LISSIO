use super::*;

#[test]
fn crc8_zero_input() {
    assert_eq!(
        compute_checksum(ChecksumKind::Crc8, b"").unwrap(),
        vec![0x00]
    );
}

#[test]
fn crc16_modbus_zero_input() {
    // 0xFFFF in LE = [0xFF, 0xFF]
    assert_eq!(
        compute_checksum(ChecksumKind::Crc16Modbus, b"").unwrap(),
        vec![0xff, 0xff]
    );
}

#[test]
fn crc16_ccitt_zero_input() {
    // 0xFFFF in BE = [0xFF, 0xFF]
    assert_eq!(
        compute_checksum(ChecksumKind::Crc16CCITT, b"").unwrap(),
        vec![0xff, 0xff]
    );
}

#[test]
fn sum8_basic() {
    assert_eq!(
        compute_checksum(ChecksumKind::Sum8, &[0x01, 0x02]).unwrap(),
        vec![0x03]
    );
    assert_eq!(
        compute_checksum(ChecksumKind::Sum8, &[0xff, 0x01]).unwrap(),
        vec![0x00]
    );
}

#[test]
fn xor8_basic() {
    assert_eq!(
        compute_checksum(ChecksumKind::Xor8, &[0xaa, 0x55]).unwrap(),
        vec![0xff]
    );
}

#[test]
fn lrc_basic() {
    // LRC 是 (-sum) & 0xff; sum8([0x01,0x02])=0x03, LRC=0xFD
    assert_eq!(
        compute_checksum(ChecksumKind::Lrc, &[0x01, 0x02]).unwrap(),
        vec![0xfd]
    );
}

#[test]
fn custom_unsupported() {
    assert!(compute_checksum(ChecksumKind::Custom, b"abc").is_err());
}
