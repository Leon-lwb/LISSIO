//! 设备列举 — 串口发现与 CandleLight 设备。
//!
//! 串口走 `app::SerialDiscovery` 端口 (L4 `serial` 实现由宿主注入), 与桌面 IPC
//! 命令层调用同一份平台枚举管线。

use backend_host::BackendHost;
use serde_json::Value;

use crate::args::{RpcError, domain, text};

/// 列出系统可用串口 (含平台元数据补全)。
pub fn list_ports(host: &BackendHost) -> Result<Value, RpcError> {
    text(host.state.serial_discovery().list_ports())
}

/// 列出全部 CandleLight 设备。
pub fn list_candle_devices() -> Result<Value, RpcError> {
    domain(can_transport::candle::list_devices())
}
