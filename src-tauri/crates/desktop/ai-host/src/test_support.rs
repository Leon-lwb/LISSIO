//! 测试专用路径工具。
//!
//! 并行用例可能在同一纳秒内取样 `SystemTime`，只用时间戳拼临时路径会撞名，
//! 导致用例互相覆盖文件（例如把一个用例写的非 UTF-8 内容读成坏数据）。
//! 因此唯一后缀 = 进程号 + 纳秒时间戳 + 进程内单调序号。

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// 返回进程内唯一的临时路径，调用前该路径不存在。
///
/// 调用方决定它被当作目录还是文件使用，并自行负责清理。
pub fn unique_temp_path(prefix: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("系统时间早于 UNIX 纪元")
        .as_nanos();
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    std::env::temp_dir().join(format!("{prefix}-{pid}-{stamp}-{sequence}"))
}
