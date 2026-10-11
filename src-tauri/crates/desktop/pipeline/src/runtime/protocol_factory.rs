//! 协议引擎工厂 — 按 `ProtocolConfig` 构造对应的解析/编码引擎
//!
//! 层级: L2 pipeline (runtime) — L1 协议 crate 的统一构造入口;
//! 协议状态复位 (set_protocol 等运行时换引擎路径) 经 [`create_engine`] 重建。

use logic_decoder::LogicDecoderEngine;
use protocol::ProtocolEngine;
use protocol_can_bridge::{CandleEngine as Candle, RawDataEngine as RawData, SlcanEngine as Slcan};
use protocol_float::{FireWaterEngine as FireWater, JustFloatEngine as JustFloat};
use schema_types::ProtocolConfig;

/// 根据配置创建协议引擎
pub fn create_engine(config: &ProtocolConfig) -> Box<dyn ProtocolEngine> {
    match config {
        ProtocolConfig::JustFloat { channels } => Box::new(JustFloat::new(*channels)),
        ProtocolConfig::FireWater { channels } => Box::new(FireWater::new(*channels)),
        ProtocolConfig::RawData => Box::new(RawData::new()),
        ProtocolConfig::Slcan => Box::new(Slcan::new()),
        ProtocolConfig::CandleLight => Box::new(Candle::new()),
        ProtocolConfig::LogicDecode { decoder } => {
            Box::new(LogicDecoderEngine::new(decoder.clone()))
        }
        ProtocolConfig::Diagnostic { .. } => Box::new(RawData::new()),
    }
}

#[cfg(test)]
#[path = "protocol_factory_tests.rs"]
mod tests;
