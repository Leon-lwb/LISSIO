//! `lissio-server` 进程内存与生命周期诊断日志。
//!
//! 默认每 5s 输出 debug 快照；设置 `LISSIO_MEMORY_DIAGNOSTICS=1` 后提升为 info，
//! 便于桌面 sidecar 默认日志级别直接观察断连后的 RSS/堆持有变化。

use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use backend_host::BackendHost;

/// 启动周期诊断任务。
pub fn spawn(host: Arc<BackendHost>) {
    let elevated = std::env::var_os("LISSIO_MEMORY_DIAGNOSTICS").is_some();
    tokio::spawn(async move {
        let mut previous_rss_kb = None;
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval.tick().await;
        loop {
            interval.tick().await;
            let rss_kb = process_rss_kb();
            let delta_kb = previous_rss_kb.zip(rss_kb).and_then(|(previous, current)| {
                let previous = i64::try_from(previous).ok()?;
                let current = i64::try_from(current).ok()?;
                Some(current - previous)
            });
            previous_rss_kb = rss_kb;
            let level = if elevated {
                log::Level::Info
            } else {
                log::Level::Debug
            };
            log::log!(
                level,
                "内存诊断: rss_kb={}, rss_delta_kb={}, {}",
                rss_kb.map_or_else(|| "n/a".to_string(), |value| value.to_string()),
                delta_kb.map_or_else(|| "n/a".to_string(), |value| value.to_string()),
                host.state.lifecycle_summary()
            );
        }
    });
}

/// POSIX `ps` 读取当前进程 RSS (KiB)。失败只影响诊断字段，不影响服务。
fn process_rss_kb() -> Option<u64> {
    let output = Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout)
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
}
