use super::*;

#[test]
fn sysfs_interface_description_and_usb_identity_are_read_together() {
    let root = std::env::temp_dir().join(format!("lissio-sysfs-{}", std::process::id()));
    let device = root.join("usb/interface/ttyUSB0");
    std::fs::create_dir_all(&device).unwrap();
    for (key, value) in [
        ("idVendor", "1a86\n"),
        ("idProduct", "7523\n"),
        ("product", "USB Serial\n"),
        ("manufacturer", "WCH\n"),
    ] {
        std::fs::write(root.join("usb").join(key), value).unwrap();
    }
    std::fs::write(root.join("usb/interface/interface"), "Debug UART\n").unwrap();
    let mut port = PortInfo {
        name: "/dev/ttyUSB0".into(),
        port_type: "Unknown".into(),
        vid: None,
        pid: None,
        product: None,
        manufacturer: None,
        serial_number: None,
        description: None,
    };
    enrich_from_device(&mut port, &device);
    assert_eq!(port.description.as_deref(), Some("Debug UART"));
    assert_eq!(port.product.as_deref(), Some("USB Serial"));
    assert_eq!((port.vid, port.pid), (Some(0x1a86), Some(0x7523)));
    assert_eq!(port.port_type, "USB");
    std::fs::remove_dir_all(root).unwrap();
}
