//! 数据平面批处理/worker 自动调节器 — 迟滞避免负载边界反复扩缩

use std::time::Duration;

use crate::types::RuntimeLimits;

/// 数据平面批处理/worker 自动调节器。用迟滞避免负载边界反复扩缩。
#[derive(Debug, Clone)]
pub struct AdaptiveController {
    workers: usize,
    high_streak: u8,
    low_since: Option<std::time::Instant>,
    target_batch_bytes: usize,
    /// 吞吐 regime 的服务时间目标 (ms)。积压持续时 16→64 上探:
    /// 占空比 ≈ service_time/target, 目标必须大于服务时间才能排空积压。
    service_target_ms: u32,
    ewma_input_bytes_per_sec: u64,
    last_observed: std::time::Instant,
}

impl Default for AdaptiveController {
    fn default() -> Self {
        Self {
            workers: 1,
            high_streak: 0,
            low_since: None,
            target_batch_bytes: 64 * 1024,
            service_target_ms: 16,
            ewma_input_bytes_per_sec: 0,
            last_observed: std::time::Instant::now(),
        }
    }
}

impl AdaptiveController {
    pub fn observe(
        &mut self,
        queue_fill: f64,
        queue_age: Duration,
        service_time: Duration,
        input_bytes: usize,
        limits: RuntimeLimits,
    ) {
        self.observe_at(
            std::time::Instant::now(),
            queue_fill,
            queue_age,
            service_time,
            input_bytes,
            limits,
        );
    }

    /// 单一观察时刻同时用于速率、扩缩容与基准测试，避免测试回拨后再读时钟。
    fn observe_at(
        &mut self,
        now: std::time::Instant,
        queue_fill: f64,
        queue_age: Duration,
        service_time: Duration,
        input_bytes: usize,
        limits: RuntimeLimits,
    ) {
        let elapsed_us = u64::try_from(
            now.saturating_duration_since(self.last_observed)
                .as_micros(),
        )
        .unwrap_or(u64::MAX)
        .max(1);
        self.last_observed = now;
        let current_rate = u64::try_from(input_bytes)
            .unwrap_or(u64::MAX)
            .saturating_mul(1_000_000)
            / elapsed_us;
        self.ewma_input_bytes_per_sec = if self.ewma_input_bytes_per_sec == 0 {
            current_rate
        } else {
            self.ewma_input_bytes_per_sec
                .saturating_mul(4)
                .saturating_add(current_rate)
                / 5
        };

        let max_workers = limits
            .max_workers
            .min(std::thread::available_parallelism().map_or(1, std::num::NonZero::get))
            .max(1);
        if queue_fill > 0.5 || queue_age > Duration::from_millis(10) {
            self.high_streak = self.high_streak.saturating_add(1);
            self.low_since = None;
            if self.high_streak >= 3 && self.workers < max_workers {
                self.workers += 1;
                self.high_streak = 0;
            }
        } else if queue_fill < 0.1 && queue_age < Duration::from_millis(2) {
            let since = self.low_since.get_or_insert(now);
            if now.saturating_duration_since(*since) >= Duration::from_secs(2) && self.workers > 1 {
                self.workers -= 1;
                self.low_since = Some(now);
            }
        } else {
            self.high_streak = 0;
            self.low_since = None;
        }

        // —— 批大小策略: 吞吐/延迟双 regime ——
        // 旧策略「service_time > 16ms 就减半」在服务时间含数值平面评估 (数十毫秒)
        // 时会长期触发, 批被压到下限 → 同样输入速率下批次翻倍 → 占空比超 100% →
        // 持续 Lagged (越堵越切小批的死亡螺旋)。新策略:
        // 1. 到达不变量: 每批至少合流「上一批服务期间到达」的量
        //    (ewma_rate × service_time), 否则队列单调增长, 丢数据只是时间问题;
        // 2. 深队列 (吞吐 regime): 目标 = ewma_rate × service_target,
        //    service_target 随积压持续 16→64ms 上探, 摊薄每批固定开销;
        // 3. 浅队列 (延迟 regime): 目标 = ewma_rate × 8ms, 小批快转。
        let deep_queue = queue_fill > 0.5 || queue_age > Duration::from_millis(10);
        if deep_queue {
            self.service_target_ms = self.service_target_ms.saturating_mul(2).min(64);
        } else if queue_fill < 0.1 && queue_age < Duration::from_millis(2) {
            self.service_target_ms = (self.service_target_ms / 2).max(8);
        }
        let target_ms = u64::from(if deep_queue {
            self.service_target_ms
        } else {
            8
        });
        let rate_target = self.ewma_input_bytes_per_sec.saturating_mul(target_ms) / 1_000;
        // 到达下限同量纲换算: ewma[B/s] × service_ms / 1000 = 服务期内到达字节
        let service_floor = self
            .ewma_input_bytes_per_sec
            .saturating_mul(u64::try_from(service_time.as_millis()).unwrap_or(u64::MAX))
            / 1_000;
        let target = rate_target
            .max(service_floor)
            .clamp(16 * 1024_u64, 1024 * 1024_u64);
        let target = usize::try_from(target).unwrap_or(1024 * 1024);
        if target > self.target_batch_bytes {
            // 过载方向快速响应 (积压增长速度远快于平滑收敛)
            self.target_batch_bytes = target;
        } else {
            self.target_batch_bytes = (self.target_batch_bytes * 3 + target) / 4;
        }
    }

    #[must_use]
    pub const fn workers(&self) -> usize {
        self.workers
    }

    #[must_use]
    pub const fn target_batch_bytes(&self) -> usize {
        self.target_batch_bytes
    }

    #[must_use]
    pub const fn ewma_input_bytes_per_sec(&self) -> u64 {
        self.ewma_input_bytes_per_sec
    }
}

#[cfg(test)]
#[path = "adaptive_tests.rs"]
mod tests;
