//! Deterministic generators shared by byte and point simulations.
use crate::{AcquisitionError, AcquisitionResult};
use data_model::device::{SignalParameters, SimulationConfig, TestWaveform};
use data_model::simulation::{MAX_SAMPLE_RATE, SimulationRate};
use schema_types::ProtocolConfig;

pub fn validate(config: &SimulationConfig) -> AcquisitionResult<()> {
    // 上限为流式协议的采样率上限（见 `data_model::simulation`）；帧定界协议另由
    // [`validate_for_protocol`] 按帧率上限收窄。
    if !(1..=MAX_SAMPLE_RATE).contains(&config.sample_rate) || !(1..=256).contains(&config.channels)
    {
        return Err(AcquisitionError::InvalidConfig(
            "simulation rate/channels out of range".into(),
        ));
    }
    for signal in std::iter::once(&config.signal).chain(config.overrides.values()) {
        if !signal.frequency.is_finite()
            || signal.frequency < 0.0
            || !signal.amplitude.is_finite()
            || signal.amplitude < 0.0
            || !signal.offset.is_finite()
        {
            return Err(AcquisitionError::InvalidConfig(
                "invalid simulation signal parameters".into(),
            ));
        }
    }
    Ok(())
}

/// 按下游协议的量纲校验模拟配置。
///
/// `SimulationConfig::sample_rate` 的语义随协议而变: 帧定界协议
/// ([`ProtocolConfig::is_frame_oriented`]) 下每个采样点产出一帧 CAN 报文, 该值即
/// 帧率。用户若按「对齐 500k 波特率」把它填成 500 000, 链路会以 50 万帧/s 运行
/// (真实 CAN 总线 2~5 k帧/s), 广播环与缓冲会按该量级驻留数百 MB。故此处按
/// [`ProtocolConfig::max_simulation_rate`] 收窄上限, 并以类型构造完成校验。
///
/// # Errors
///
/// 基础范围校验失败, 或速率超过该协议量纲上限时返回
/// [`AcquisitionError::InvalidConfig`]。
pub fn validate_for_protocol(
    config: &SimulationConfig,
    protocol: &ProtocolConfig,
) -> AcquisitionResult<()> {
    validate(config)?;
    let max = protocol.max_simulation_rate();
    SimulationRate::new(config.sample_rate, max).map_err(|error| {
        let dimension = if protocol.is_frame_oriented() {
            "CAN frame rate (frames/s)"
        } else {
            "sample rate (samples/s)"
        };
        AcquisitionError::InvalidConfig(format!(
            "{error} — with this protocol the simulation rate is a {dimension}, \
             so it must not be derived from the bus bitrate"
        ))
    })?;
    Ok(())
}

#[allow(clippy::cast_precision_loss)]
pub fn sample(signal: &SignalParameters, seed: u32, index: u64, rate: u32, key: &str) -> f64 {
    let phase = (index as f64 / f64::from(rate) * signal.frequency).fract();
    let wave = match signal.waveform {
        TestWaveform::Sine => (phase * std::f64::consts::TAU).sin(),
        TestWaveform::Square => {
            if phase < 0.5 {
                1.0
            } else {
                -1.0
            }
        }
        TestWaveform::Triangle => 4.0_f64.mul_add(-(phase - 0.5).abs(), 1.0),
        TestWaveform::Sawtooth => 2.0_f64.mul_add(phase, -1.0),
        TestWaveform::Dc => 1.0,
        TestWaveform::Random => {
            let mut value = u64::from(seed) ^ index.wrapping_mul(0x9e37_79b9_7f4a_7c15);
            for byte in key.bytes() {
                value = (value ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3);
            }
            value ^= value >> 30;
            value = value.wrapping_mul(0xbf58_476d_1ce4_e5b9);
            value ^= value >> 27;
            value = value.wrapping_mul(0x94d0_49bb_1331_11eb);
            value ^= value >> 31;
            ((value >> 11) as f64 / ((1_u64 << 53) as f64)).mul_add(2.0, -1.0)
        }
    };
    signal.amplitude.mul_add(wave, signal.offset)
}

#[cfg(test)]
#[path = "simulation_tests.rs"]
mod tests;
