use super::{parse_hex, parse_inputs};

#[test]
fn hex_parsing_accepts_common_writings() {
    assert_eq!(parse_hex("AABB"), Ok(vec![0xAA, 0xBB]));
    assert_eq!(parse_hex("aa bb"), Ok(vec![0xAA, 0xBB]));
    assert_eq!(parse_hex("0xAA,0x01"), Ok(vec![0xAA, 0x01]));
    assert_eq!(parse_hex(""), Ok(Vec::new()));
    // 空白/逗号是分隔符: 奇数长度的分段拼接连读 (A B = AB)
    assert_eq!(parse_hex("A B"), Ok(vec![0xAB]));
    assert!(parse_hex("A B C").is_err(), "拼后为奇数长度应报错");
    assert!(parse_hex("ZZ").is_err());
}

#[test]
fn input_pairs_parse_to_map() {
    let inputs = parse_inputs(&["ch1=1.5".into(), "ch2=-2".into()]).expect("valid pairs");
    assert_eq!(inputs.get("ch1"), Some(&1.5));
    assert_eq!(inputs.get("ch2"), Some(&-2.0));
    assert!(parse_inputs(&["novalue".into()]).is_err());
}
