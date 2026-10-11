//! 协议配置 — schema 的 preset_config / TestDataLink.protocol 用。
//!
//! 仅保留 schema 所需的最小集 (ProtocolConfig);
//! 传输 / 控件 / 流水线配置由 `data_model::config` 承担。

use diagnostic::DiagnosticConfig;
use logic::LogicDecoderConfig;
use serde::{Deserialize, Serialize};

/// 协议配置
/// channels: None = 自动检测通道数, Some(n) = 手动指定
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, ts_rs::TS)]
#[serde(tag = "kind")]
pub enum ProtocolConfig {
    JustFloat {
        channels: Option<usize>,
    },
    FireWater {
        channels: Option<usize>,
    },
    RawData,
    Slcan,
    CandleLight,
    LogicDecode {
        decoder: LogicDecoderConfig,
    },
    /// 诊断协议层 (ISO-TP / UDS / OBD-II / J1939)
    ///
    /// 注意:诊断流程走独立的 `DiagnosticEngine` + `BridgeCanBackend` 管线,
    /// 不通过 `ProtocolEngine` 的 feed/encode 通路。`create_engine` 对此变体
    /// 返回 `RawDataEngine` 占位,真正的诊断 dispatch 在 `state.rs` 中实现。
    Diagnostic {
        config: DiagnosticConfig,
    },
}

impl Default for ProtocolConfig {
    fn default() -> Self {
        Self::JustFloat { channels: Some(4) }
    }
}

impl ProtocolConfig {
    /// 手动指定的通道数 (仅 JustFloat/FireWater 有通道概念; None = 自动检测或无通道概念)
    pub const fn manual_channels(&self) -> Option<usize> {
        match self {
            Self::JustFloat { channels } | Self::FireWater { channels } => *channels,
            _ => None,
        }
    }

    /// 该协议是否按「每个采样点产出一帧 CAN 报文」工作 —— 即生成速率的量纲是**帧率**。
    ///
    /// 仅 [`Self::Slcan`] 与 [`Self::CandleLight`] 是帧定界的: 前者每个采样点产出一条
    /// ASCII 帧 (`t<id><dlc><data>\r`), 后者产出一条 24 字节二进制帧。此时
    /// `SimulationConfig::sample_rate` 的语义是 CAN 帧率, 上限必须按
    /// [`data_model::simulation::MAX_FRAME_RATE`] 收窄。
    ///
    /// [`Self::LogicDecode`] 刻意**不**计入: 它每个采样点只产出一个字节 (8 通道打包电平),
    /// 字节流速率与采样率同阶, 不存在帧数放大。
    /// 用穷尽 `match` 而非 `matches!`: 新增协议变体时编译失败, 强制其归类者显式
    /// 决定量纲, 而不是静默落入「非帧定界」的默认分支。
    pub const fn is_frame_oriented(&self) -> bool {
        match self {
            Self::Slcan | Self::CandleLight => true,
            Self::JustFloat { .. }
            | Self::FireWater { .. }
            | Self::RawData
            | Self::LogicDecode { .. }
            | Self::Diagnostic { .. } => false,
        }
    }

    /// 模拟生成速率在本协议量纲下的上限 (采样/秒 或 帧/秒)。
    ///
    /// # Examples
    ///
    /// ```
    /// use schema_types::ProtocolConfig;
    /// use data_model::simulation::{MAX_FRAME_RATE, MAX_SAMPLE_RATE};
    ///
    /// assert_eq!(ProtocolConfig::Slcan.max_simulation_rate(), MAX_FRAME_RATE);
    /// assert_eq!(
    ///     ProtocolConfig::JustFloat { channels: None }.max_simulation_rate(),
    ///     MAX_SAMPLE_RATE
    /// );
    /// ```
    pub const fn max_simulation_rate(&self) -> u32 {
        if self.is_frame_oriented() {
            data_model::simulation::MAX_FRAME_RATE
        } else {
            data_model::simulation::MAX_SAMPLE_RATE
        }
    }
}

#[cfg(test)]
#[path = "protocol_config_tests.rs"]
mod tests;
