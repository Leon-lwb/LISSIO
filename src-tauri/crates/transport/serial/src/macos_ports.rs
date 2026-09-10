//! Supplement serialport with macOS system names and DriverKit device identity.
//! No port is opened; IORegistry handles and CF properties are released by RAII.
use core_foundation::{
    base::{CFType, TCFType},
    number::CFNumber,
    string::CFString,
};
use data_model::PortInfo;
use io_kit_sys::{
    IOIteratorNext, IOObjectRelease, IORegistryEntryCreateCFProperty,
    IORegistryEntryGetParentEntry, IOServiceGetMatchingServices, IOServiceMatching,
    types::io_object_t,
};
use std::collections::HashMap;

struct IoObject(io_object_t);

impl Drop for IoObject {
    fn drop(&mut self) {
        // SAFETY: each nonzero handle was returned with an owned IOKit reference.
        unsafe { IOObjectRelease(self.0) };
    }
}

fn property(entry: io_object_t, key: &str) -> Option<CFType> {
    let key = CFString::new(key);
    // SAFETY: entry is live, key is a valid CFString, null selects the default allocator.
    let value = unsafe {
        IORegistryEntryCreateCFProperty(entry, key.as_concrete_TypeRef(), std::ptr::null(), 0)
    };
    if value.is_null() {
        None
    } else {
        // SAFETY: CreateCFProperty transfers one owned reference to the caller.
        Some(unsafe { CFType::wrap_under_create_rule(value) })
    }
}

fn string(entry: io_object_t, key: &str) -> Option<String> {
    property(entry, key)?
        .downcast::<CFString>()
        .map(|value| value.to_string())
        .filter(|value| !value.trim().is_empty())
}

fn number(entry: io_object_t, key: &str) -> Option<u16> {
    property(entry, key)?
        .downcast::<CFNumber>()?
        .to_i64()
        .and_then(|value| u16::try_from(value).ok())
}

#[derive(Clone, Default)]
struct SystemPort {
    name: Option<String>,
    callout: Option<String>,
    bluetooth: bool,
    vid: Option<u16>,
    pid: Option<u16>,
    product: Option<String>,
    manufacturer: Option<String>,
    serial_number: Option<String>,
}

impl SystemPort {
    fn inspect(&mut self, entry: io_object_t) {
        self.bluetooth |= ["IOClass", "IOUserClass", "CFBundleIdentifier"]
            .iter()
            .filter_map(|key| string(entry, key))
            .any(|value| value.contains("Bluetooth"));
        // Only take USB identity from a single device registry entry, never mix
        // IDs or strings from different ancestors (such as an upstream hub).
        if self.vid.is_none() && number(entry, "idVendor").is_some() {
            self.vid = number(entry, "idVendor");
            self.pid = number(entry, "idProduct");
            self.product = string(entry, "USB Product Name");
            self.manufacturer = string(entry, "USB Vendor Name");
            self.serial_number = string(entry, "USB Serial Number");
        }
    }

    fn apply(&self, port: &mut PortInfo) {
        if let Some(callout) = &self.callout {
            port.name.clone_from(callout);
        }
        port.description = port
            .description
            .take()
            .or_else(|| self.product.clone())
            .or_else(|| port.product.clone())
            .or_else(|| self.name.clone());
        if self.bluetooth {
            port.port_type = "Bluetooth".into();
        } else if self.vid.is_some() {
            port.port_type = "USB".into();
            port.vid = self.vid.or(port.vid);
            port.pid = self.pid.or(port.pid);
            port.product = port.product.take().or_else(|| self.product.clone());
            port.manufacturer = port
                .manufacturer
                .take()
                .or_else(|| self.manufacturer.clone());
            port.serial_number = port
                .serial_number
                .take()
                .or_else(|| self.serial_number.clone());
        } else if port.port_type == "PCI" {
            // serialport uses PCI as its macOS catch-all, not evidence of a PCI device.
            port.port_type = "Unknown".into();
        }
    }
}

pub fn enrich_ports(ports: &mut [PortInfo]) {
    let mut iterator = 0;
    // SAFETY: matching receives a static NUL-terminated class name; the matching
    // dictionary is consumed by GetMatchingServices, including on failure.
    let status = unsafe {
        let matching = IOServiceMatching(c"IOSerialBSDClient".as_ptr());
        if matching.is_null() {
            return;
        }
        IOServiceGetMatchingServices(0, matching, &raw mut iterator)
    };
    if status != 0 || iterator == 0 {
        return;
    }
    let iterator = IoObject(iterator);
    let mut descriptions = HashMap::new();
    loop {
        // SAFETY: iterator is owned and valid throughout this loop.
        let entry = unsafe { IOIteratorNext(iterator.0) };
        if entry == 0 {
            break;
        }
        let entry = IoObject(entry);
        let paths: Vec<_> = ["IOCalloutDevice", "IODialinDevice"]
            .iter()
            .filter_map(|key| string(entry.0, key))
            .collect();
        let mut info = SystemPort {
            name: string(entry.0, "IOTTYDevice"),
            callout: string(entry.0, "IOCalloutDevice"),
            ..Default::default()
        };
        info.inspect(entry.0);
        let mut current = entry;
        // Bound traversal even if a malformed driver publishes a cyclic registry.
        for _ in 0..32 {
            if info.bluetooth || info.vid.is_some() {
                break;
            }
            let mut parent = 0;
            // SAFETY: current is live; parent is an initialized output slot.
            let status = unsafe {
                IORegistryEntryGetParentEntry(current.0, c"IOService".as_ptr(), &raw mut parent)
            };
            if status != 0 || parent == 0 {
                break;
            }
            current = IoObject(parent);
            info.inspect(current.0);
        }
        for path in paths {
            descriptions.insert(path, info.clone());
        }
    }
    for port in ports {
        if let Some(info) = descriptions.get(&port.name) {
            info.apply(port);
        }
    }
}

#[cfg(test)]
mod tests {
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
}
