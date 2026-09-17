//! Deterministic generators shared by byte and point simulations.
use crate::{AcquisitionError, AcquisitionResult};
use data_model::device::{SignalParameters, SimulationConfig, TestWaveform};

pub fn validate(config: &SimulationConfig) -> AcquisitionResult<()> {
    // 上限 5 MHz 为 4ch JustFloat 100 MB/s 压测留余量；更高会单 tick 生成
    // 巨量字节，属误配而非合法仿真。
    if !(1..=5_000_000).contains(&config.sample_rate) || !(1..=256).contains(&config.channels) {
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
mod tests {
    use super::*;
    #[test]
    fn deterministic_random_and_wave_parameters() {
        let signal = SignalParameters {
            waveform: TestWaveform::Random,
            amplitude: 2.0,
            offset: 4.0,
            ..Default::default()
        };
        let a: Vec<_> = (0..100)
            .map(|i| sample(&signal, 42, i, 100, "pressure"))
            .collect();
        let b: Vec<_> = (0..100)
            .map(|i| sample(&signal, 42, i, 100, "pressure"))
            .collect();
        assert_eq!(a, b);
        assert!(a.iter().all(|x| (2.0..=6.0).contains(x)));
        assert!(
            (sample(&signal, 42, 1, 100, "pressure") - sample(&signal, 43, 1, 100, "pressure"))
                .abs()
                > f64::EPSILON
        );
    }
}
