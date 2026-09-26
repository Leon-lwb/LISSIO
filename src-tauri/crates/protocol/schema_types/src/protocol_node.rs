//! 持久化协议引擎设备节点配置，供设备树和执行图共同使用。

use crate::{ProtocolConfig, ProtocolSchema};
use serde::{Deserialize, Serialize};

/// 协议节点的解析、转换和自定义帧配置。
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolNodeConfig {
    pub protocol: ProtocolConfig,
    #[serde(default)]
    pub convert_to: Option<ProtocolConfig>,
    #[serde(default)]
    pub schema: Option<ProtocolSchema>,
}
