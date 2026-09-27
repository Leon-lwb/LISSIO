//! schema → ProtocolEngine 编译入口

use protocol::ProtocolEngine;
use schema_types::{ProtocolConfig, ProtocolSchema, SchemaPreset};

use crate::engine::SchemaEngine;

/// 编译帧 schema 为协议引擎
///
/// - `preset != Custom`: 用 `preset_config` 经 [`compile_preset`] 分发到预设引擎
///   (JustFloat/FireWater/Slcan/CandleLight/RawData/LogicDecode), 完整保留自动
///   检测 / 并行 split / CAN / 逻辑事件能力;
/// - `Custom`: 构造 [`SchemaEngine`] (流式帧解码 + encode 块编码)。
pub fn compile_schema(schema: &ProtocolSchema) -> Box<dyn ProtocolEngine> {
    if schema.preset != SchemaPreset::Custom
        && let Some(config) = schema.preset_config.clone()
    {
        return compile_preset(config);
    }
    Box::new(SchemaEngine::new(schema.clone()))
}

/// 按 `ProtocolConfig` 调度到对应子 crate 的预设协议引擎
pub fn compile_preset(config: ProtocolConfig) -> Box<dyn ProtocolEngine> {
    use protocol_can_bridge::{CandleEngine, RawDataEngine, SlcanEngine};
    use protocol_float::{FireWaterEngine, JustFloatEngine};
    match config {
        ProtocolConfig::JustFloat { channels } => Box::new(JustFloatEngine::new(channels)),
        ProtocolConfig::FireWater { channels } => Box::new(FireWaterEngine::new(channels)),
        ProtocolConfig::RawData => Box::new(RawDataEngine::new()),
        ProtocolConfig::Slcan => Box::new(SlcanEngine::new()),
        ProtocolConfig::CandleLight => Box::new(CandleEngine::new()),
        ProtocolConfig::LogicDecode { .. } => Box::new(RawDataEngine::new()),
        // Diagnostic 不走 ProtocolEngine 路径 (走独立 DiagnosticEngine), 此处回落到 RawData 占位
        ProtocolConfig::Diagnostic { .. } => Box::new(RawDataEngine::new()),
    }
}
