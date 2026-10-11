use super::*;

fn port(name: &str) -> PortInfo {
    PortInfo {
        name: name.into(),
        port_type: "USB".into(),
        vid: Some(0x1234),
        pid: Some(0x5678),
        description: None,
        product: Some(" USB Serial ".into()),
        manufacturer: None,
        serial_number: Some("shared".into()),
    }
}

#[test]
fn windows_aliases_merge_and_friendly_name_does_not_repeat_com() {
    let mut first = port(r"\\.\com3");
    first.description = Some("USB Serial (COM3)".into());
    let ports = normalize(vec![first, port("COM3")], true);
    assert_eq!(ports.len(), 1);
    assert_eq!(ports[0].name, "COM3");
    assert_eq!(ports[0].description.as_deref(), Some("USB Serial"));
}

#[test]
fn identical_hardware_ids_do_not_merge_distinct_interfaces() {
    let ports = normalize(
        vec![
            port("/dev/ttyUSB1"),
            port("/dev/ttyUSB0"),
            port("/dev/ttyUSB0"),
        ],
        false,
    );
    assert_eq!(ports.len(), 2);
    assert_eq!(ports[0].description.as_deref(), Some("USB Serial"));
}
