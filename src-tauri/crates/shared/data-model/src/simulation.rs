//! 模拟生成节拍契约 — 速率语义、消息大小与消息间隔的唯一权威。
//!
//! 生成侧 (`transport::test_data`、`transport::byte_simulation`) 与消费侧的
//! `broadcast::Lagged` 折算 (`pipeline::data_plane`) 必须使用同一份换算:
//! 消息大小不自洽时, 丢包换算出来的时间缺口会被成倍放大或缩小, 而两侧各自
//! 演化没有任何编译期约束。故把共同依赖的换算收进本模块。
//!
//! 另一个被本模块显式化的契约是**速率的量纲**。同一个
//! [`SimulationConfig::sample_rate`](crate::device::SimulationConfig::sample_rate)
//! 在流式协议下是采样率, 在帧定界协议 (SLCAN / CandleLight) 下则是帧率 ——
//! 后者每个采样点产出一帧报文。用裸 `u32` 承载时, 「为对齐 500k 波特率」填进去
//! 的 500 000 会直接变成 50 万帧/s。上限由 [`SimulationRate`] 按量纲分别承载,
//! 使误配无法通过构造。量纲分类的唯一权威是
//! [`ProtocolConfig::is_frame_oriented`](schema_types::ProtocolConfig::is_frame_oriented),
//! 本模块只提供两个上限本身。

use std::fmt;
use std::time::Duration;

/// 每条广播消息覆盖的采样时长 (秒)。
///
/// 生成器按该时长决定单条消息携带的采样数, 因此当速率不低于
/// `1 / MESSAGE_SAMPLE_SECONDS` = 200 采样/秒时, 消息条率约为 200 条/s
/// **与速率无关**, 只有消息**大小**随速率增长。速率低于 200 采样/秒时
/// 每条消息退化为 1 个采样, 消息条率等于速率本身。
pub const MESSAGE_SAMPLE_SECONDS: f64 = 0.005;

/// 流式协议的速率上限 (采样/秒)。
///
/// 为 4ch JustFloat 100 MB/s 压测留余量; 更高会单 tick 生成巨量字节,
/// 属误配而非合法仿真。
pub const MAX_SAMPLE_RATE: u32 = 5_000_000;

/// 帧定界协议的速率上限 (帧/秒)。
///
/// 该量纲下每个采样点产出一帧 CAN/数字报文。真实 CAN 总线为 2~5 k帧/s,
/// 故上限取比真实总线宽一个量级的 20 k帧/s: 足以覆盖压力场景, 又能拦住
/// 「按波特率折算帧率」这一量纲误用。超限以配置错误拒绝, 不做静默截断。
pub const MAX_FRAME_RATE: u32 = 20_000;

/// 速率不在 `1..=max` 内。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RateRangeError {
    /// 被拒绝的速率值。
    pub value: u32,
    /// 该量纲的上限。
    pub max: u32,
}

impl fmt::Display for RateRangeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "simulation rate {} out of range 1..={}",
            self.value, self.max
        )
    }
}

impl std::error::Error for RateRangeError {}

/// 已按量纲上限校验的生成速率。
///
/// 只能经 [`SimulationRate::new`] 构造, 因此「已被校验」是类型携带的事实,
/// 下游不再需要重复判断范围, 也不会退回到魔法系数 (`rate / 200`) 的换算。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct SimulationRate(u32);

impl SimulationRate {
    /// 以给定上限校验后构造速率。
    ///
    /// # Errors
    ///
    /// `value` 为 0 或超过 `max` 时返回 [`RateRangeError`]。
    pub const fn new(value: u32, max: u32) -> Result<Self, RateRangeError> {
        if value == 0 || value > max {
            return Err(RateRangeError { value, max });
        }
        Ok(Self(value))
    }

    /// 原始速率值 (采样/秒 或 帧/秒, 取决于协议量纲)。
    #[must_use]
    pub const fn get(self) -> u32 {
        self.0
    }

    /// 本速率下每条广播消息携带的采样数 (与 [`samples_per_message`] 同源)。
    #[must_use]
    pub fn samples_per_message(self) -> u64 {
        samples_per_message(rate_as_f32(self.0))
    }

    /// 消息条率 (条/秒) —— 速率 ≥ 200 采样/秒时约为 `1 / MESSAGE_SAMPLE_SECONDS`,
    /// 低于该速率时等于速率本身 (每条消息退化为 1 个采样)。
    #[must_use]
    #[allow(clippy::cast_precision_loss)]
    pub fn messages_per_second(self) -> f64 {
        let samples = self.samples_per_message();
        f64::from(self.0) / samples as f64
    }

    /// 相邻两条消息的名义间隔。
    #[must_use]
    #[allow(clippy::cast_precision_loss)] // 采样数上界 25 000, 远在 f64 精确表示范围内
    pub fn message_interval(self) -> Duration {
        let samples = self.samples_per_message();
        Duration::from_secs_f64(samples as f64 / f64::from(self.0))
    }
}

/// 速率以 `f32` 携带时的无损转换 (1..=5e6 全部可精确表示)。
#[allow(clippy::cast_precision_loss)]
const fn rate_as_f32(rate: u32) -> f32 {
    rate as f32
}

/// 每条广播消息覆盖的采样数 — 生成器与 `Lagged` 折算共用的消息大小契约。
///
/// 修改消息节拍时必须与 [`MESSAGE_SAMPLE_SECONDS`] 一并评估, 数据平面据同一
/// 换算把 `broadcast::Lagged(消息数)` 还原成丢失采样数。
///
/// 三个 cast lint 都在此豁免, 因为 `.max(1.0)` + `.ceil()` 已经把结果钉成
/// 「≥ 1 的整数」: 无符号丢失不成立 (非负), 截断不成立 (已取整), 精度丢失不成立
/// (上界 [`MAX_SAMPLE_RATE`] × [`MESSAGE_SAMPLE_SECONDS`] = 25 000 ≪ 2^53)。
#[must_use]
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss
)]
pub fn samples_per_message(sample_rate: f32) -> u64 {
    (f64::from(sample_rate.max(1.0)) * MESSAGE_SAMPLE_SECONDS)
        .ceil()
        .max(1.0) as u64
}

#[cfg(test)]
#[path = "simulation_tests.rs"]
mod tests;
