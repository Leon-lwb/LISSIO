//! 自适应速率推送循环 — 各数据主题共用
//!
//! 所有分发循环共用 [`AdaptiveRate`] 做速率自适应:
//! - 每次实际发送 → 间隔减半 (不低于 min), 数据越快推得越勤
//! - 每次空转 (无数据变化) → 间隔 ×1.5 (不超过 max), 空闲自动降频退避
//!
//! 变化检测由调用方提供的 `make_batch` 闭包完成 (返回 `None` 表示无变化),
//! 通常基于各缓冲区的单调 version 计数器, 零额外拷贝。
//!
//! 推送经 [`crate::sink::StreamSink`] 端口 (本 crate 不依赖 Tauri): 组合根注入
//! Channel 适配实现, 无界面宿主注入自己的实现。

pub use pipeline::runtime::AdaptiveRate;

use crate::sink::{StreamPayload, StreamSink};
use std::sync::Arc;
use tokio::sync::oneshot;

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
    F: FnMut() -> Option<StreamPayload>,
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
