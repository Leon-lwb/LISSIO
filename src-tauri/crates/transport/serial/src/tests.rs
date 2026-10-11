use super::port_metadata;
use data_model::PortInfo;

#[test]
fn metadata_includes_all_present_usb_fields() {
    let port = PortInfo {
        name: "/dev/ttyUSB0".into(),
        port_type: "USB".into(),
        vid: Some(0x1a86),
        pid: Some(0x7523),
        serial_number: Some("ABC123".into()),
        manufacturer: Some("wch.cn".into()),
        product: Some("USB Serial".into()),
        description: Some("System USB Serial".into()),
    };
    let metadata = port_metadata(&port);
    assert_eq!(
        metadata["description"],
        serde_json::json!("System USB Serial")
    );
    assert_eq!(metadata["portType"], serde_json::json!("USB"));
    assert_eq!(metadata["vid"], serde_json::json!(0x1a86));
    assert_eq!(metadata["pid"], serde_json::json!(0x7523));
    assert_eq!(metadata["serialNumber"], serde_json::json!("ABC123"));
    assert_eq!(metadata["manufacturer"], serde_json::json!("wch.cn"));
    assert_eq!(metadata["product"], serde_json::json!("USB Serial"));
}

#[test]
fn metadata_omits_absent_fields() {
    let port = PortInfo {
        name: "COM3".into(),
        port_type: "PCI".into(),
        vid: None,
        pid: None,
        serial_number: None,
        manufacturer: None,
        product: None,
        description: None,
    };
    let metadata = port_metadata(&port);
    assert_eq!(metadata.len(), 2);
    assert_eq!(metadata["portType"], serde_json::json!("PCI"));
}
