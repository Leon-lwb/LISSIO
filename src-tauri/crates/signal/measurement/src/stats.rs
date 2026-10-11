//! 单通道窗口统计 — Vpp/极值/均值/RMS(含直流与去直流)/占空比
//!
//! 输入为金字塔快照序列: 原始路径为逐样本真值; 金字塔包络路径为 (min,max)
//! 对中点近似 — 注意 vmin/vmax/vpp 在任何层都精确 (包络极值即真值),
//! 仅 vavg/vrms 随层粗化产生近似误差。NaN 样本一律跳过。

use serde::Serialize;

/// vpp 低于该绝对阈值视为平直信号 — 周期/占空比不再有意义
pub const FLAT_SIGNAL_VPP: f64 = 1e-6;

/// 单通道窗口统计
#[derive(Debug, Clone, Serialize)]
pub struct ChannelStats {
    /// 峰峰值 (任何层都精确)
    pub vpp: f64,
    /// 最小值 (精确)
    pub vmin: f64,
    /// 最大值 (精确)
    pub vmax: f64,
    /// 均值 (包络层为中点近似)
    pub vavg: f64,
    /// RMS, 含直流分量
    pub vrms: f64,
    /// RMS, 去直流 — AC 耦合显示换算用 (sqrt(E[x²] − mean²))
    pub vrms_ac: f64,
    /// 占空比 — 中阈值 (均值) 上方时间占比 [0,1]; 平直信号为 None
    pub duty: Option<f64>,
}

/// 单遍扫描统计; 无有效 (非 NaN) 样本时返回 None
pub fn channel_stats(values: &[f32]) -> Option<ChannelStats> {
    let mut vmin = f64::INFINITY;
    let mut vmax = f64::NEG_INFINITY;
    let (mut sum, mut sq_sum) = (0.0_f64, 0.0_f64);
    let mut n = 0_usize;
    for &v in values {
        let v = f64::from(v);
        if !v.is_finite() {
            continue;
        }
        if v < vmin {
            vmin = v;
        }
        if v > vmax {
            vmax = v;
        }
        sum += v;
        sq_sum = v.mul_add(v, sq_sum);
        n += 1;
    }
    if n == 0 {
        return None;
    }
    #[allow(clippy::cast_precision_loss)] // 计数转统计量, 点数上限受快照预算约束
    let n_f = n as f64;
    let vavg = sum / n_f;
    let vrms = (sq_sum / n_f).sqrt();
    let vrms_ac = vavg.mul_add(-vavg, sq_sum / n_f).max(0.0).sqrt();
    let vpp = vmax - vmin;
    let duty = if vpp > FLAT_SIGNAL_VPP {
        let threshold = vavg;
        let above = values.iter().filter(|&&v| f64::from(v) > threshold).count();
        #[allow(clippy::cast_precision_loss)]
        let duty = above as f64 / n_f;
        Some(duty)
    } else {
        None
    };
    Some(ChannelStats {
        vpp,
        vmin,
        vmax,
        vavg,
        vrms,
        vrms_ac,
        duty,
    })
}

#[cfg(test)]
#[path = "stats_tests.rs"]
mod tests;
