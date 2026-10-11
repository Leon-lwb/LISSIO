//! 波形包络 — 逐列 min/max 压缩的纯 CPU 核心 + GPU 加速端口
//!
//! 「wgpu 预处理渲染波形, 前端只显示」论证结论的落地形态: GPU 擅长的逐点
//! 归约压缩 — N 点 → columns×(min, max, count) — 让前端 uPlot 以缎带绘制
//! 全窗口包络, 数据量缩小 N/columns 倍。
//!
//! 本模块是 L1 确定性核心: 类型、列映射与 CPU 参考实现 (GPU 不可用时的
//! 回退路径与等价性仲裁基准) 都在这里; GPU 加速实现由 [`EnvelopeEngine`]
//! 端口的 L4 实现 (`gpu` crate) 提供, 组合根注入 — L1-L3 不依赖 wgpu。
//!
//! 数值约定:
//! - 列映射: `col(i) = floor((i + 0.5) * columns / n)` (f32 运算, CPU/GPU
//!   同式同精度 → 同列归属; 0.5 偏移让每列近似等宽)
//! - min/max 只统计非 NaN 样本; 空列 (无样本或全 NaN) min=+inf / max=-inf /
//!   count=0 — 前端按断线处理
//! - ±0 归一为 +0 (保序位键要求; 显示上 ±0 等同)

/// 逐列包络 — 长度均为 `columns` (空列: min=+inf / max=-inf / count=0)
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Envelope {
    /// 列内非 NaN 样本最小值 (空列 +inf)
    pub min: Vec<f32>,
    /// 列内非 NaN 样本最大值 (空列 -inf)
    pub max: Vec<f32>,
    /// 列内非 NaN 样本数
    pub count: Vec<u32>,
}

impl Envelope {
    /// 列是否为空 (无有效样本)
    #[must_use]
    pub fn is_empty_column(&self, col: usize) -> bool {
        self.count.get(col).is_none_or(|&c| c == 0)
    }
}

/// 列映射 — CPU/GPU 共用的 f32 同式实现 (见模块注释)
///
/// cast lint 有意豁免: usize→f32 截断与 f32→u32 转换是 CPU/GPU 位级一致的
/// 前提 (WGSL 侧同为 f32/u32 运算), 不可用更宽类型替代
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
#[must_use]
pub fn column_of(i: usize, n: usize, columns: usize) -> usize {
    let scale = columns as f32 / n as f32;
    let col = ((i as f32 + 0.5) * scale).floor();
    if col < 0.0 {
        0
    } else {
        usize::try_from(col as u32)
            .unwrap_or(columns - 1)
            .min(columns - 1)
    }
}

/// ±0 归一 — 保序位键的前置条件 (CPU/WGSL 同语义)
fn normalize(v: f32) -> f32 {
    if v == 0.0 { 0.0 } else { v }
}

/// CPU 参考实现 — 线性扫描 (GPU 不可用时的回退路径与等价性仲裁基准)
// cast 豁免理由同 [`column_of`]
#[allow(clippy::cast_precision_loss)]
#[must_use]
pub fn envelope_minmax_cpu(values: &[f32], columns: usize) -> Envelope {
    let mut out = Envelope {
        min: vec![f32::INFINITY; columns],
        max: vec![f32::NEG_INFINITY; columns],
        count: vec![0; columns],
    };
    let n = values.len();
    for (i, &v0) in values.iter().enumerate() {
        if v0.is_nan() {
            continue;
        }
        let v = normalize(v0);
        let col = column_of(i, n, columns);
        out.min[col] = out.min[col].min(v);
        out.max[col] = out.max[col].max(v);
        out.count[col] += 1;
    }
    out
}

/// 包络计算端口 — 依赖倒置点: L1-L3 只依赖本 trait, GPU 加速实现 (wgpu)
/// 由 `gpu` crate (L4) 提供并经组合根注入。
///
/// 实现约定: 必须失败安全 — 任何内部错误都回退到 [`envelope_minmax_cpu`]
/// 同等语义, 不得 panic、不得返回错误 (显示流热路径)。
pub trait EnvelopeEngine: Send + Sync + 'static {
    /// 对单通道样本做逐列 min/max 压缩。
    fn envelope_minmax(&self, values: &[f32], columns: usize) -> Envelope;
}

/// 纯 CPU 引擎 — 无 GPU 路径的默认实现 (测试 / 无界面宿主兜底)。
#[derive(Debug, Clone, Copy, Default)]
pub struct CpuEnvelopeEngine;

impl EnvelopeEngine for CpuEnvelopeEngine {
    fn envelope_minmax(&self, values: &[f32], columns: usize) -> Envelope {
        envelope_minmax_cpu(values, columns)
    }
}

#[cfg(test)]
#[path = "envelope_tests.rs"]
mod tests;
