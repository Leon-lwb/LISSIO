use super::*;

#[test]
fn ready_line_is_a_parseable_handshake_record() {
    let line = ready_line(64784);
    let payload = line
        .strip_prefix("LISSIO_READY=")
        .expect("握手行必须带 LISSIO_READY= 前缀");
    let parsed: serde_json::Value = serde_json::from_str(payload).expect("握手行必须是 JSON");
    assert_eq!(parsed["port"], 64784);
    assert_eq!(parsed["protocol"], PROTOCOL_VERSION);
    assert_eq!(parsed["version"], env!("CARGO_PKG_VERSION"));
}
