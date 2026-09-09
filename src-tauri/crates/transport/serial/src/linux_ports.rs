//! Linux system descriptions supplement libudev/serialport through sysfs.
//! Missing attributes and unplug races retain the original enumeration result.
use data_model::PortInfo;
use std::path::Path;

#[cfg(target_os = "linux")]
pub fn enrich_ports(ports: &mut [PortInfo]) {
    for port in ports {
        if let Ok(path) = std::fs::canonicalize(&port.name) {
            port.name = path.to_string_lossy().into_owned();
        }
        let Some(name) = Path::new(&port.name).file_name() else { continue; };
        let device = Path::new("/sys/class/tty").join(name).join("device");
        if let Ok(device) = std::fs::canonicalize(device) { enrich_from_device(port, &device); }
    }
}

fn text(path: &Path, key: &str) -> Option<String> {
    std::fs::read_to_string(path.join(key)).ok()
        .map(|value| value.trim().to_owned()).filter(|value| !value.is_empty())
}

fn hex(path: &Path, key: &str) -> Option<u16> {
    u16::from_str_radix(&text(path, key)?, 16).ok()
}

fn enrich_from_device(port: &mut PortInfo, device: &Path) {
    let mut interface = None;
    for ancestor in device.ancestors().take(32) {
        if !ancestor.is_dir() { return; }
        interface = interface.or_else(|| text(ancestor, "interface"));
        // Stop at the nearest USB device. An upstream hub is not this port.
        if ancestor.join("idVendor").exists() || ancestor.join("idProduct").exists() {
            port.port_type = "USB".into();
            port.vid = hex(ancestor, "idVendor").or(port.vid);
            port.pid = hex(ancestor, "idProduct").or(port.pid);
            port.product = text(ancestor, "product").or_else(|| port.product.take());
            port.manufacturer = text(ancestor, "manufacturer").or_else(|| port.manufacturer.take());
            port.serial_number = text(ancestor, "serial").or_else(|| port.serial_number.take());
            break;
        }
    }
    port.description = interface.or_else(|| port.description.take()).or_else(|| port.product.clone());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sysfs_interface_description_and_usb_identity_are_read_together() {
        let root = std::env::temp_dir().join(format!("lissio-sysfs-{}", std::process::id()));
        let device = root.join("usb/interface/ttyUSB0");
        std::fs::create_dir_all(&device).unwrap();
        for (key, value) in [("idVendor", "1a86\n"), ("idProduct", "7523\n"), ("product", "USB Serial\n"), ("manufacturer", "WCH\n")] {
            std::fs::write(root.join("usb").join(key), value).unwrap();
        }
        std::fs::write(root.join("usb/interface/interface"), "Debug UART\n").unwrap();
        let mut port = PortInfo { name: "/dev/ttyUSB0".into(), port_type: "Unknown".into(),
            vid: None, pid: None, product: None, manufacturer: None, serial_number: None, description: None };
        enrich_from_device(&mut port, &device);
        assert_eq!(port.description.as_deref(), Some("Debug UART"));
        assert_eq!(port.product.as_deref(), Some("USB Serial"));
        assert_eq!((port.vid, port.pid), (Some(0x1a86), Some(0x7523)));
        assert_eq!(port.port_type, "USB");
        std::fs::remove_dir_all(root).unwrap();
    }
}
