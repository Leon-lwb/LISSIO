//! 控件数据绑定
//!
//! [`WidgetBinding`] 描述输入控件到传输通道的绑定模式 (None/Auto/Manual)。

use serde::{Deserialize, Serialize};

/// 控件数据绑定
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", content = "params")]
pub enum WidgetBinding {
    /// 不绑定
    None,
    /// 自动绑定到 VOFA 通道
    Auto {
        #[serde(rename = "transportId")]
        transport_id: String,
        #[serde(rename = "protocolId")]
        protocol_id: String,
        channel: usize,
    },
    /// 手动命令模板, {value} 会被替换
    Manual {
        #[serde(rename = "transportId")]
        transport_id: String,
        template: String,
    },
}
