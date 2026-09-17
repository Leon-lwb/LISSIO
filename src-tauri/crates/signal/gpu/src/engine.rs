//! 自适应包络引擎 — [`waveform::EnvelopeEngine`] 端口的 GPU 加速实现
//!
//! L4 适配器: 内部惰性获取全局 `GpuContext` (失败缓存 `None`), GPU 路径
//! 出错自动回退 CPU 参考实现 — 失败安全契约由 `waveform::EnvelopeEngine`
//! 文档约定, 本实现不得上抛错误。

use waveform::{Envelope, EnvelopeEngine, envelope_minmax_cpu};

use crate::GpuContext;
use crate::envelope::envelope_minmax;

/// GPU 优先 / CPU 回退的自适应引擎 (组合根注入 [`waveform::EnvelopeEngine`])。
#[derive(Debug, Clone, Copy, Default)]
pub struct AdaptiveEnvelopeEngine;

impl EnvelopeEngine for AdaptiveEnvelopeEngine {
    fn envelope_minmax(&self, values: &[f32], columns: usize) -> Envelope {
        // GpuContext::acquire 内部全局缓存 — 重复调用廉价
        let Some(ctx) = GpuContext::acquire() else {
            return envelope_minmax_cpu(values, columns.max(1));
        };
        envelope_minmax(&ctx, values, columns)
            .unwrap_or_else(|_| envelope_minmax_cpu(values, columns.max(1)))
    }
}
