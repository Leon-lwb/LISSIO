//! Sample-driven FFT; display consumers receive only the most recent spectrum.
pub use crate::window::WindowType;
use crate::{SpectrumFrame, StreamingFft, TransformConfig, TransformError};
use serde::{Deserialize, Serialize};

/// 频谱输出模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, ts_rs::TS)]
pub enum SpectrumOutput {
    /// 振幅谱 |X(k)| / N
    #[default]
    Magnitude,
    /// 功率谱 |X(k)|^2 / N^2
    Power,
    /// 功率谱密度 |X(k)|^2 / (N * fs * cg^2), cg=窗相干增益
    PSD,
    /// 10 * log10(Power + eps), 单位 dB
    Decibel,
}

/// 频谱计算结果 — 一组 (频率, 值) 配对
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
pub struct SpectrumResult {
    /// 频率 (Hz), 长度 = window_size / 2 + 1
    pub frequencies: Vec<f32>,
    /// 频谱值 (Magnitude/Power/PSD/Decibel), 与 frequencies 对齐
    pub values: Vec<f32>,
}

pub struct SpectrumAnalyzer {
    config: TransformConfig,
    output: SpectrumOutput,
    stream: StreamingFft,
    latest: Option<SpectrumFrame>,
    samples: usize,
    epoch: u64,
    #[cfg(test)]
    frequencies: Vec<f32>,
}

impl SpectrumAnalyzer {
    pub fn new(n: usize, window: WindowType, output: SpectrumOutput, sample_rate: f32) -> Self {
        Self::with_config(
            TransformConfig {
                window_size: n.max(2),
                hop_size: (n / 2).max(1),
                window_type: window,
                sample_rate,
            },
            output,
        )
        .expect("validated FFT configuration")
    }

    #[allow(clippy::cast_precision_loss)]
    pub fn with_config(
        config: TransformConfig,
        output: SpectrumOutput,
    ) -> Result<Self, TransformError> {
        let stream = StreamingFft::new(config, 0)?;
        Ok(Self {
            config,
            output,
            stream,
            latest: None,
            samples: 0,
            epoch: 0,
            #[cfg(test)]
            frequencies: (0..=config.window_size / 2)
                .map(|k| k as f32 * config.sample_rate / config.window_size as f32)
                .collect(),
        })
    }

    pub fn push(&mut self, value: f32) {
        self.push_with(value, |_| {});
    }

    /// Consumers run synchronously for each completed frame; nothing queues behind UI refresh.
    pub fn push_with(&mut self, value: f32, mut emit: impl FnMut(&SpectrumFrame)) {
        self.samples = self.samples.saturating_add(1);
        let latest = &mut self.latest;
        self.stream
            .push(&[value], |frame| {
                emit(&frame);
                *latest = Some(frame);
            })
            .expect("analyser stream is open");
    }

    pub fn push_slice(&mut self, values: &[f32]) {
        for &value in values {
            self.push(value);
        }
    }

    pub const fn is_ready(&self) -> bool {
        self.samples >= self.config.window_size
    }
    pub const fn window_size(&self) -> usize {
        self.config.window_size
    }
    pub const fn hop_size(&self) -> usize {
        self.config.hop_size
    }
    pub const fn sample_rate(&self) -> f32 {
        self.config.sample_rate
    }
    pub const fn window_type(&self) -> WindowType {
        self.config.window_type
    }
    pub const fn output(&self) -> SpectrumOutput {
        self.output
    }

    pub fn compute(&mut self) -> Option<SpectrumResult> {
        if !self.is_ready() {
            return None;
        }
        self.latest.take().map(|frame| frame.display(self.output))
    }

    pub const fn set_output(&mut self, output: SpectrumOutput) {
        self.output = output;
    }

    pub fn set_window_type(&mut self, window_type: WindowType) {
        self.config.window_type = window_type;
        self.stream = StreamingFft::new(self.config, self.epoch + 1).expect("valid window overlap");
        self.reset();
    }

    pub fn reset(&mut self) {
        self.epoch = self.epoch.wrapping_add(1);
        self.stream.reset(self.epoch);
        self.samples = 0;
        self.latest = None;
    }
}

#[cfg(test)]
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap
)]
#[path = "spectrum_tests.rs"]
mod tests;
