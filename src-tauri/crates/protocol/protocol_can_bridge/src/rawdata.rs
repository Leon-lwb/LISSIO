use protocol::{FeedOutput, ProtocolEngine};

/// RawData 协议引擎 — 不解析, 仅透传
///
/// 接收的原始字节不产生 DataFrame, 由前端直接显示
pub struct RawDataEngine;

impl RawDataEngine {
    pub const fn new() -> Self {
        Self
    }
}

impl ProtocolEngine for RawDataEngine {
    fn feed(&mut self, _data: &[u8]) -> FeedOutput {
        // RawData 不产生结构化数据帧
        FeedOutput::default()
    }

    fn encode_channel(&mut self, _channel: usize, value: f32) -> Vec<u8> {
        protocol::text::encode_ascii_value(value)
    }

    fn encode_channels(&mut self, values: &[f32]) -> Vec<u8> {
        protocol::text::encode_ascii_values(values)
    }

    fn name(&self) -> &'static str {
        "RawData"
    }

    fn encode_frame(&mut self, _frame: &data_model::DataFrame) -> Vec<u8> {
        // RawData 无帧概念, DataFrame 重编码语义不符
        Vec::new()
    }

    fn new_worker(&self) -> Box<dyn ProtocolEngine> {
        Box::new(Self::new())
    }
}

impl Default for RawDataEngine {
    fn default() -> Self {
        Self::new()
    }
}
