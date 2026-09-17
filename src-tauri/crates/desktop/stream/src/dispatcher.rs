//! 自适应速率推送循环 — 各数据主题共用
//!
//! 所有分发循环共用 [`AdaptiveRate`] 做速率自适应:
//! - 每次实际发送 → 间隔减半 (不低于 min), 数据越快推得越勤
//! - 每次空转 (无数据变化) → 间隔 ×1.5 (不超过 max), 空闲自动降频退避
//!
//! 变化检测由调用方提供的 `make_batch` 闭包完成 (返回 `None` 表示无变化),
//! 通常基于各缓冲区的单调 version 计数器, 零额外拷贝。
//!
//! 推送经 [`StreamSink`] 端口 (本 crate 不依赖 Tauri): 组合根注入 Channel
//! 适配实现, 无界面宿主注入自己的实现。

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::oneshot;

/// 流推送端口 — 一个逻辑订阅一个实现实例 (与 `app::display::StreamSink`
/// 同角色; 本 crate 不依赖 app, 独立定义)。
///
/// 实现约定: `send` 失败 (对端关闭) 返回 `false`, 推送循环据此退出;
/// 实现不得 panic、不得在热路径上无界阻塞。
pub trait StreamSink: Send + Sync + 'static {
    /// 订阅 id — 取消注册 / 日志的键。
    fn id(&self) -> u32;
    /// 推送一条 JSON payload; `false` = 订阅应终止。
    fn send(&self, payload: serde_json::Value) -> bool;
}

/// 自适应推送速率控制器
///
/// `current` 在 `[min, max]` 内动态调整:
/// - `on_send()`: 有数据发出, 提速 (÷2, 不低于 min)
/// - `on_idle()`: 无数据变化, 降频 (×1.5, 不超过 max)
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

/// 单订阅者自适应推送循环
///
/// 每次 wake 调用 `make_payload` (同步闭包, 内部做变化检测与快照):
/// - `Some(payload)` → 通过 sink 发送, `rate.on_send()`; 对端关闭则退出
/// - `None` → 不发送, `rate.on_idle()` 退避
///
/// 收到 `cancel_rx` 信号优雅退出。`name` 仅用于日志。
pub async fn adaptive_stream_loop<F>(
    name: &str,
    sink: Arc<dyn StreamSink>,
    mut rate: AdaptiveRate,
    mut make_payload: F,
    mut cancel_rx: oneshot::Receiver<()>,
) where
    F: FnMut() -> Option<serde_json::Value>,
{
    let channel_id = sink.id();
    log::debug!(
        "{} 订阅已启动, channel_id={}, 初始间隔={}ms",
        name,
        channel_id,
        rate.current().as_millis()
    );
    loop {
        tokio::select! {
            _ = &mut cancel_rx => {
                log::debug!("{name} 订阅被取消, channel_id={channel_id}");
                break;
            }
            () = tokio::time::sleep(rate.current()) => {
                match make_payload() {
                    Some(payload) => {
                        if !sink.send(payload) {
                            log::debug!("{name} 订阅通道已关闭, channel_id={channel_id}");
                            break;
                        }
                        rate.on_send();
                    }
                    None => rate.on_idle(),
                }
            }
        }
    }
}
