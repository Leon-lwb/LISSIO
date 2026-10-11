//! Shared enumeration pipeline: platform evidence → normalization → unique ports.
use data_model::PortInfo;
use error::Result;
use error::TransportError;
use serialport::SerialPortType;

pub fn list_ports() -> Result<Vec<PortInfo>> {
    let ports =
        serialport::available_ports().map_err(|e| TransportError::SerialEnumeration(e.into()))?;
    let mut result: Vec<PortInfo> = ports
        .into_iter()
        .map(|p| {
            let (port_type, vid, pid, serial_number, manufacturer, product) = match p.port_type {
                SerialPortType::UsbPort(info) => (
                    "USB".to_string(),
                    Some(info.vid),
                    Some(info.pid),
                    info.serial_number,
                    info.manufacturer,
                    info.product,
                ),
                SerialPortType::PciPort => ("PCI".to_string(), None, None, None, None, None),
                SerialPortType::BluetoothPort => {
                    ("Bluetooth".to_string(), None, None, None, None, None)
                }
                SerialPortType::Unknown => ("Unknown".to_string(), None, None, None, None, None),
            };
            let description = None;
            PortInfo {
                name: p.port_name,
                port_type,
                vid,
                pid,
                serial_number,
                manufacturer,
                product,
                description,
            }
        })
        .collect();
    #[cfg(target_os = "macos")]
    crate::macos_ports::enrich_ports(&mut result);
    #[cfg(windows)]
    {
        let descriptions = crate::windows_ports::port_descriptions();
        for port in &mut result {
            port.description = descriptions.get(&port.name.to_ascii_uppercase()).cloned();
        }
    }
    #[cfg(target_os = "linux")]
    crate::linux_ports::enrich_ports(&mut result);
    Ok(normalize(result, cfg!(windows)))
}

fn clean(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn normalize(ports: Vec<PortInfo>, windows: bool) -> Vec<PortInfo> {
    let mut unique = std::collections::BTreeMap::<String, PortInfo>::new();
    for mut port in ports {
        if windows {
            port.name = port.name.trim_start_matches(r"\\.\").to_ascii_uppercase();
        }
        port.description = clean(port.description);
        port.product = clean(port.product);
        port.manufacturer = clean(port.manufacturer);
        port.serial_number = clean(port.serial_number);
        if windows && let Some(description) = &port.description {
            let suffix = format!(" ({})", port.name);
            if description.to_ascii_uppercase().ends_with(&suffix) {
                port.description =
                    clean(Some(description[..description.len() - suffix.len()].into()));
            }
        }
        port.description = port.description.or_else(|| port.product.clone());
        // Never merge on USB IDs, product names or serial numbers: different
        // devices and multiple interfaces of one device can share all of them.
        unique
            .entry(port.name.clone())
            .and_modify(|existing| {
                existing.description = existing
                    .description
                    .take()
                    .or_else(|| port.description.clone());
                existing.product = existing.product.take().or_else(|| port.product.clone());
                existing.manufacturer = existing
                    .manufacturer
                    .take()
                    .or_else(|| port.manufacturer.clone());
                existing.serial_number = existing
                    .serial_number
                    .take()
                    .or_else(|| port.serial_number.clone());
                existing.vid = existing.vid.or(port.vid);
                existing.pid = existing.pid.or(port.pid);
            })
            .or_insert(port);
    }
    unique.into_values().collect()
}

#[cfg(test)]
#[path = "ports_tests.rs"]
mod tests;
