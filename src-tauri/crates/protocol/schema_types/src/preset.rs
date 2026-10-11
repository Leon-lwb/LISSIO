//! 协议预设工厂 — 所有协议创建入口共用 (前端调色板 / 模板 / AI / MCP)。
//!
//! 单一事实源: 预设 (JustFloat/FireWater/RawData/Slcan/CandleLight/LogicDecode)
//! 的 schema 组装规则只在这里定义; 前端不再手写第二份工厂。
//! 与前端 `protocolSchema.ts` 输出逐字一致 (fixture 验证)。

use crate::decoder_block::{DecoderBlockDef, FieldType};
use crate::protocol_config::ProtocolConfig;
use crate::schema_frame::{ProtocolSchema, SchemaPreset};

/// 预设默认端口数 (自动检测生效前的占位, 端口语义仍走引擎自动检测)
pub const DEFAULT_PRESET_CHANNELS: usize = 4;

/// JustFloat 帧尾 (0x00 0x00 0x80 0x7F, LE +Inf)
pub const JUSTFLOAT_TAIL_HEX: &str = "00 00 80 7F";

/// JustFloat 帧尾字节 — 与 [`JUSTFLOAT_TAIL_HEX`] 同一事实
pub const JUSTFLOAT_TAIL: [u8; 4] = [0x00, 0x00, 0x80, 0x7F];

/// JustFloat 预设: n×field{float32LE, portName ch{i}} + tail{00 00 80 7F}
///
/// `channels = None` (自动) 也生成默认 4 端口, 端口语义仍走引擎自动检测。
pub fn justfloat_schema(channels: Option<usize>) -> ProtocolSchema {
    build_float_schema(SchemaPreset::JustFloat, channels)
}

/// FireWater 预设: csv 块 (逗号分隔, 列 → ch0..chN 端口)
pub fn firewater_schema(channels: Option<usize>) -> ProtocolSchema {
    ProtocolSchema {
        preset: SchemaPreset::FireWater,
        preset_config: Some(ProtocolConfig::FireWater { channels }),
        decode: vec![DecoderBlockDef::Csv {
            separator: ",".to_owned(),
            ports: channel_port_names(channels),
        }],
        encode: None,
    }
}

/// RawData 预设: 原始字节透传, 无 decode 块
pub const fn raw_data_schema() -> ProtocolSchema {
    ProtocolSchema {
        preset: SchemaPreset::RawData,
        preset_config: Some(ProtocolConfig::RawData),
        decode: Vec::new(),
        encode: None,
    }
}

/// Slcan 预设: CAN 帧走预设引擎, 无 decode 块
pub const fn slcan_schema() -> ProtocolSchema {
    ProtocolSchema {
        preset: SchemaPreset::Slcan,
        preset_config: Some(ProtocolConfig::Slcan),
        decode: Vec::new(),
        encode: None,
    }
}

/// CandleLight 预设: CAN 帧走预设引擎, 无 decode 块
pub const fn candle_light_schema() -> ProtocolSchema {
    ProtocolSchema {
        preset: SchemaPreset::CandleLight,
        preset_config: Some(ProtocolConfig::CandleLight),
        decode: Vec::new(),
        encode: None,
    }
}

/// LogicDecode 预设: samples 块委托给逻辑解码器
pub fn logic_decode_schema(decoder: logic::LogicDecoderConfig) -> ProtocolSchema {
    ProtocolSchema {
        preset: SchemaPreset::LogicDecode,
        preset_config: Some(ProtocolConfig::LogicDecode {
            decoder: decoder.clone(),
        }),
        decode: vec![DecoderBlockDef::Samples { decoder }],
        encode: None,
    }
}

/// ProtocolConfig → 预设 schema (节点创建用)。
/// Diagnostic 无 schema 预设: custom + 空 decode (诊断 I/O 走独立管线)。
pub fn schema_from_protocol_config(config: &ProtocolConfig) -> ProtocolSchema {
    match config {
        ProtocolConfig::JustFloat { channels } => justfloat_schema(*channels),
        ProtocolConfig::FireWater { channels } => firewater_schema(*channels),
        ProtocolConfig::RawData => raw_data_schema(),
        ProtocolConfig::Slcan => slcan_schema(),
        ProtocolConfig::CandleLight => candle_light_schema(),
        ProtocolConfig::LogicDecode { decoder } => logic_decode_schema(decoder.clone()),
        ProtocolConfig::Diagnostic { .. } => ProtocolSchema {
            preset: SchemaPreset::Custom,
            preset_config: Some(config.clone()),
            decode: Vec::new(),
            encode: None,
        },
    }
}

/// 当前生效通道数 (优先配置值, 其次检测值, 最后默认占位)。
/// RawData/Slcan/CandleLight/LogicDecode/Diagnostic 不产数值帧, 返回占位值。
pub fn effective_channels(config: &ProtocolConfig, detected: Option<usize>) -> usize {
    config
        .manual_channels()
        .unwrap_or_else(|| detected.unwrap_or(DEFAULT_PRESET_CHANNELS))
}

/// 预设/custom 协议节点的输出口名:
/// - custom schema → 按 decode 块派生 (任意数量、可命名)
/// - RawData 预设 → 单个 str 字符串口 (无 chN 数值口)
/// - 其他预设 → ch0..chN (通道数来自配置或占位默认)
pub fn protocol_port_names(
    schema: Option<&crate::ProtocolSchema>,
    config: &ProtocolConfig,
    channels: usize,
) -> Vec<String> {
    if schema.is_some_and(|schema| schema.preset == SchemaPreset::Custom) {
        return schema.map_or_else(Vec::new, crate::ProtocolSchema::port_names);
    }
    if matches!(config, ProtocolConfig::RawData) {
        return vec!["str".to_owned()];
    }
    let n = if channels > 0 {
        channels
    } else {
        effective_channels(config, None)
    };
    channel_port_names(Some(n))
}

fn build_float_schema(preset: SchemaPreset, channels: Option<usize>) -> ProtocolSchema {
    let n = channels.unwrap_or(DEFAULT_PRESET_CHANNELS);
    let mut decode = Vec::with_capacity(n + 1);
    for (i, name) in channel_port_names(Some(n)).iter().enumerate() {
        decode.push(DecoderBlockDef::Field {
            id: format!("jf-f{i}"),
            field_type: FieldType::Float32LE,
            port_name: name.clone(),
            length_ref: None,
            match_id: None,
        });
    }
    decode.push(DecoderBlockDef::Tail {
        id: "jf-tail".to_owned(),
        hex: JUSTFLOAT_TAIL_HEX.to_owned(),
        match_id: None,
    });
    ProtocolSchema {
        preset,
        preset_config: Some(ProtocolConfig::JustFloat { channels }),
        decode,
        encode: None,
    }
}

fn channel_port_names(channels: Option<usize>) -> Vec<String> {
    let n = channels.unwrap_or(DEFAULT_PRESET_CHANNELS);
    (0..n).map(|i| format!("ch{i}")).collect()
}

#[cfg(test)]
#[path = "preset_tests.rs"]
mod tests;
