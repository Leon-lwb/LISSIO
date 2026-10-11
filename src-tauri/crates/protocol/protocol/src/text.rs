//! 文本回退编码 — ASCII 浮点行 (逗号分隔 CSV) 的唯一定义处。
//!
//! FireWater / RawData / Slcan / CandleLight 四个引擎在无法结构化编码时
//! 都回退到同一种文本行; 位数与结尾换行必须逐字节一致。

/// 单值文本行 — `"{value:.6}\n"`
#[must_use]
pub fn encode_ascii_value(value: f32) -> Vec<u8> {
    format!("{value:.6}\n").into_bytes()
}

/// 多值文本行 — `"{v0:.6},{v1:.6},…\n"`
#[must_use]
pub fn encode_ascii_values(values: &[f32]) -> Vec<u8> {
    let rendered: Vec<String> = values.iter().map(|value| format!("{value:.6}")).collect();
    format!("{}\n", rendered.join(",")).into_bytes()
}
