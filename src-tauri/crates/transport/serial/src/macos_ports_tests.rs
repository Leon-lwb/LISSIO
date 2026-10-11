use super::*;

fn port() -> PortInfo {
    PortInfo {
        name: "/dev/cu.headset".into(),
        port_type: "PCI".into(),
        vid: None,
        pid: None,
        manufacturer: None,
        product: None,
        serial_number: None,
        description: None,
    }
}

#[test]
fn bluetooth_uses_system_name_without_fabricating_usb_ids() {
    let mut port = port();
    SystemPort {
        name: Some("Headset".into()),
        bluetooth: true,
        ..Default::default()
    }
    .apply(&mut port);
    assert_eq!(port.description.as_deref(), Some("Headset"));
    assert_eq!(port.port_type, "Bluetooth");
    assert_eq!((port.vid, port.pid), (None, None));
}

#[test]
fn same_registry_service_maps_dialin_to_callout() {
    let mut dialin = port();
    dialin.name = "/dev/tty.headset".into();
    SystemPort {
        callout: Some("/dev/cu.headset".into()),
        ..Default::default()
    }
    .apply(&mut dialin);
    assert_eq!(dialin.name, "/dev/cu.headset");
}

#[test]
fn usb_identity_and_product_are_preserved() {
    let mut port = port();
    SystemPort {
        name: Some("usbmodem1".into()),
        vid: Some(0x1a86),
        pid: Some(0x7523),
        product: Some("USB Serial".into()),
        ..Default::default()
    }
    .apply(&mut port);
    assert_eq!(port.description.as_deref(), Some("USB Serial"));
    assert_eq!(port.port_type, "USB");
    assert_eq!((port.vid, port.pid), (Some(0x1a86), Some(0x7523)));
}
