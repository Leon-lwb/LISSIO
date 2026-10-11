//! 自适应推送速率控制 — 单一定义处。

use std::time::Duration;

/// 自适应推送间隔 — `current` 在 `[min, max]` 内动态调整:
/// - [`Self::on_send`]: 有数据发出, 提速 (÷2, 不低于 min)
/// - [`Self::on_idle`]: 无数据变化, 降频 (×1.5, 不超过 max)
#[derive(Debug, Clone)]
pub struct AdaptiveRate {
    min: Duration,
    max: Duration,
    current: Duration,
}

impl AdaptiveRate {
    /// min: 最激进推送间隔; max: 空闲退避上限
    pub fn new(min: Duration, max: Duration) -> Self {
        debug_assert!(min <= max, "AdaptiveRate: min 必须 <= max");
        Self {
            min,
            max: max.max(min),
            current: min,
        }
    }

    /// 当前间隔
    pub const fn current(&self) -> Duration {
        self.current
    }

    /// 记录一次实际发送 — 提速
    pub fn on_send(&mut self) {
        self.current = (self.current / 2).max(self.min);
    }

    /// 记录一次空转 (无变化) — 降频
    pub fn on_idle(&mut self) {
        self.current = (self.current + self.current / 2).min(self.max);
    }
}
