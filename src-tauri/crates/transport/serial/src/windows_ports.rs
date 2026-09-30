//! Windows 串口系统友好名称与设备描述枚举
//!
//! `serialport` crate 的 UsbPortInfo 只暴露 product/manufacturer/serial_number，
//! 本模块使用 SetupAPI 枚举 Ports / Modem 两类设备，优先读取 FriendlyName，
//! 回退到 Description，建立 `COM端口名 -> 系统描述` 映射。

use std::collections::HashMap;
use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
    DICS_FLAG_GLOBAL, DIGCF_PRESENT, DIREG_DEV, SP_DEVINFO_DATA, SPDRP_DEVICEDESC,
    SPDRP_FRIENDLYNAME, SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInfo, SetupDiGetClassDevsW,
    SetupDiGetDeviceRegistryPropertyW, SetupDiOpenDevRegKey,
};
use windows_sys::Win32::Foundation::{BOOL, ERROR_SUCCESS, HWND, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Registry::{HKEY, KEY_READ, RegCloseKey, RegQueryValueExW};
use windows_sys::core::GUID;

/// 设备类 GUID: Ports (COM & LPT ports)
const GUID_DEVCLASS_PORTS: GUID = GUID {
    data1: 0x4D36E978,
    data2: 0xE325,
    data3: 0x11CE,
    data4: [0xBF, 0xC1, 0x08, 0x00, 0x2B, 0xE1, 0x03, 0x18],
};

/// 设备类 GUID: Modem
const GUID_DEVCLASS_MODEM: GUID = GUID {
    data1: 0x4D36E96D,
    data2: 0xE325,
    data3: 0x11CE,
    data4: [0xBF, 0xC1, 0x08, 0x00, 0x2B, 0xE1, 0x03, 0x18],
};

/// 读取设备管理器中的 Description，建立端口名映射。
///
/// Prefer the localized Device Manager friendly name, then the device description.
pub fn port_descriptions() -> HashMap<String, String> {
    let mut map = HashMap::new();

    for guid in [&GUID_DEVCLASS_PORTS, &GUID_DEVCLASS_MODEM] {
        // SAFETY: 所有 SetupDi*/Reg* 调用的参数均为本模块分配的有效结构或返回的
        // 句柄;info_set 失败/枚举错误都经返回值检查,句柄用后即毁,不跨线程共享。
        unsafe {
            let info_set = SetupDiGetClassDevsW(guid, std::ptr::null(), 0 as HWND, DIGCF_PRESENT);
            if info_set == INVALID_HANDLE_VALUE {
                continue;
            }

            let mut dev_info = SP_DEVINFO_DATA {
                cbSize: u32::try_from(std::mem::size_of::<SP_DEVINFO_DATA>())
                    .expect("SP_DEVINFO_DATA 的 cbSize 远小于 u32 上限"),
                ClassGuid: GUID {
                    data1: 0,
                    data2: 0,
                    data3: 0,
                    data4: [0; 8],
                },
                DevInst: 0,
                Reserved: 0,
            };

            let mut index = 0u32;
            while SetupDiEnumDeviceInfo(info_set, index, &raw mut dev_info) != 0 {
                index += 1;

                // 打开设备注册表键，读取 PortName
                let hkey = SetupDiOpenDevRegKey(
                    info_set,
                    &raw const dev_info,
                    DICS_FLAG_GLOBAL,
                    0,
                    DIREG_DEV,
                    KEY_READ,
                );
                if hkey == INVALID_HANDLE_VALUE {
                    continue;
                }

                let port_name = match read_reg_string(hkey, "PortName") {
                    Some(name) if !name.is_empty() => name,
                    _ => {
                        let _ = RegCloseKey(hkey);
                        continue;
                    }
                };
                let _ = RegCloseKey(hkey);

                // 过滤并口（LPT）
                if port_name.to_ascii_uppercase().starts_with("LPT") {
                    continue;
                }

                // 优先读取设备管理器的友好名称。
                if let Some(description) =
                    read_device_description(info_set, &raw const dev_info, SPDRP_FRIENDLYNAME)
                        .or_else(|| {
                            read_device_description(info_set, &raw const dev_info, SPDRP_DEVICEDESC)
                        })
                    && !description.is_empty()
                {
                    map.insert(port_name.to_ascii_uppercase(), description);
                }
            }

            let _ = SetupDiDestroyDeviceInfoList(info_set);
        }
    }

    map
}

/// 从注册表键读取 UTF-16 字符串值
///
/// # Safety
/// `hkey` 必须是经 `SetupDiOpenDevRegKey`(KEY_READ)打开的有效注册表键句柄,
/// 调用方负责在读完后 `RegCloseKey`;不得与其他写操作并发使用同一句柄。
unsafe fn read_reg_string(hkey: HKEY, value_name: &str) -> Option<String> {
    let name_wide: Vec<u16> = value_name.encode_utf16().chain(Some(0)).collect();
    let mut buf_len: u32 = 0;
    let mut value_type: u32 = 0;

    let ret = unsafe {
        RegQueryValueExW(
            hkey,
            name_wide.as_ptr(),
            std::ptr::null(),
            &raw mut value_type,
            std::ptr::null_mut(),
            &raw mut buf_len,
        )
    };
    if ret != ERROR_SUCCESS || buf_len == 0 {
        return None;
    }

    let mut buf: Vec<u8> = vec![0; buf_len as usize];
    let ret = unsafe {
        RegQueryValueExW(
            hkey,
            name_wide.as_ptr(),
            std::ptr::null(),
            &raw mut value_type,
            buf.as_mut_ptr(),
            &raw mut buf_len,
        )
    };
    if ret != ERROR_SUCCESS {
        return None;
    }

    if value_type != 1 {
        // REG_SZ
        return None;
    }

    decode_reg_string(buf.get(..buf_len as usize)?)
}

/// 读取 SPDRP_DEVICEDESC 属性
///
/// # Safety
/// `info_set` 必须是 `SetupDiGetClassDevsW` 返回的有效设备信息集句柄,
/// `dev_info` 必须是经 `SetupDiEnumDeviceInfo` 成功填充的结构。
unsafe fn read_device_description(
    info_set: isize,
    dev_info: *const SP_DEVINFO_DATA,
    property: u32,
) -> Option<String> {
    let mut data_type: u32 = 0;
    let mut buf_len: u32 = 0;

    let ok: BOOL = unsafe {
        SetupDiGetDeviceRegistryPropertyW(
            info_set,
            dev_info,
            property,
            &raw mut data_type,
            std::ptr::null_mut(),
            0,
            &raw mut buf_len,
        )
    };
    if ok == 0 && buf_len == 0 {
        return None;
    }

    let mut buf: Vec<u8> = vec![0; buf_len as usize];
    let ok = unsafe {
        SetupDiGetDeviceRegistryPropertyW(
            info_set,
            dev_info,
            property,
            &raw mut data_type,
            buf.as_mut_ptr(),
            buf_len,
            &raw mut buf_len,
        )
    };
    if ok == 0 {
        return None;
    }

    if data_type != 1 {
        // REG_SZ
        return None;
    }

    decode_reg_string(buf.get(..buf_len as usize)?)
}

fn decode_reg_string(bytes: &[u8]) -> Option<String> {
    let (pairs, remainder) = bytes.as_chunks::<2>();
    if !remainder.is_empty() {
        // 奇数长度不可能是完整的 UTF-16 缓冲, 视为损坏数据
        return None;
    }
    let wide: Vec<u16> = pairs
        .iter()
        .map(|pair| u16::from_le_bytes(*pair))
        .take_while(|value| *value != 0)
        .collect();
    String::from_utf16(&wide)
        .ok()
        .filter(|value| !value.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::decode_reg_string;

    #[test]
    fn registry_strings_support_localized_names_and_reject_invalid_data() {
        let bytes: Vec<u8> = "串口 (COM3)\0"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        assert_eq!(decode_reg_string(&bytes).as_deref(), Some("串口 (COM3)"));
        assert_eq!(decode_reg_string(&[0]), None);
        assert_eq!(decode_reg_string(&[0, 0xd8]), None);
        assert_eq!(decode_reg_string(&[0, 0]), None);
    }
}
