//! 窗函数 — 用于 FFT 前的加窗处理, 减少频谱泄漏
//!
//! 支持 4 种常用窗:
//! - Rect (矩形窗): 等同不加窗, 适用于瞬态信号
//! - Hann (汉宁窗): 通用, 主瓣宽旁瓣低
//! - Hamming (汉明窗): 类似 Hann 但端点不为零
//! - Blackman (布莱克曼窗): 主瓣更宽但旁瓣更低

use serde::{Deserialize, Serialize};

/// 窗函数类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default, ts_rs::TS)]
pub enum WindowType {
    /// 矩形窗 (不加窗)
    Rect,
    /// 汉宁窗 — 通用, 主瓣宽旁瓣低
    #[default]
    Hann,
    /// 汉明窗 — 端点不为零
    Hamming,
    /// 布莱克曼窗 — 主瓣最宽, 旁瓣最低
    Blackman,
}

impl WindowType {
    /// 返回窗函数在归一化索引 [0, 1) 处的系数 (periodic 形式, 适用于 FFT)
    /// n: 当前样本索引 (0..N)
    /// n_total: 窗长度 N
    ///
    /// 使用 periodic 形式 (t = n/N) 而非 symmetric (t = n/(N-1)),
    /// 因为 FFT 假设信号是周期性的, 且 periodic 形式的相干增益为精确值
    /// (Hann=0.5, Hamming=0.54, Blackman=0.42)。
    #[allow(clippy::cast_precision_loss, clippy::suboptimal_flops)]
    fn coeff(self, n: usize, n_total: usize) -> f32 {
        if n_total <= 1 {
            return 1.0;
        }
        let t = n as f32 / n_total as f32; // 0..1 (periodic: 不含 1.0)
        let two_pi = 2.0 * std::f32::consts::PI;
        match self {
            Self::Rect => 1.0,
            Self::Hann => 0.5 * (1.0 - (two_pi * t).cos()),
            Self::Hamming => 0.54 - 0.46 * (two_pi * t).cos(),
            Self::Blackman => {
                0.42 - 0.5 * (two_pi * t).cos() + 0.08 * (4.0 * std::f32::consts::PI * t).cos()
            }
        }
    }

    /// 窗的相干增益 (rect=1, Hann=0.5, Hamming=0.54, Blackman=0.42)
    /// 用于 PSD 计算时的归一化
    #[allow(clippy::cast_precision_loss)]
    pub fn coherent_gain(self, n_total: usize) -> f32 {
        if n_total == 0 {
            return 1.0;
        }
        let mut sum = 0.0;
        for n in 0..n_total {
            sum += self.coeff(n, n_total);
        }
        sum / n_total as f32
    }
}

/// 对数据原地应用窗函数 (data.len() 决定窗长度)
///
/// # 示例
/// ```
/// use spectrum::{apply_window, WindowType};
/// let mut data = vec![1.0; 1024];
/// apply_window(&WindowType::Hann, &mut data);
/// // 端点接近 0, 中间接近 1
/// assert!(data[0] < 0.01);
/// assert!((data[512] - 1.0).abs() < 0.01);
/// ```
pub fn apply_window(window: &WindowType, data: &mut [f32]) {
    let n = data.len();
    for (i, sample) in data.iter_mut().enumerate() {
        *sample *= window.coeff(i, n);
    }
}

#[cfg(test)]
#[path = "window_tests.rs"]
mod tests;
