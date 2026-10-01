//! 数据库文件的进程级独占守卫。
//!
//! 两个实例同时打开同一个 DuckDB 文件会各自 checkpoint 并互相覆盖, 静默抹掉
//! 已提交写入 — 这是「数据库文件损坏、历史读不出来」的成因之一。
//!
//! 拿不到守卫的实例**不阻塞**: 它退化为「录制不可用」, 采集与运行控制照常,
//! 并且这个状态在健康报告里可见。

use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};

/// 守卫文件后缀 — 与数据库同目录, 便于诊断时一眼看出谁占着。
const LOCK_SUFFIX: &str = ".lock";

#[derive(Debug)]
pub(super) struct InstanceGuard {
    /// 守卫文件本体: 句柄存活即持锁, 句柄关闭即释放 — 只被持有, 不被读取。
    _file: File,
}

impl InstanceGuard {
    /// 取得 `database` 的独占守卫; 已被别的实例持有时返回 `Ok(None)`。
    ///
    /// # Errors
    /// 守卫文件无法创建或打开 (权限 / 目录不可写) 时返回原因。
    pub(super) fn acquire(database: &Path) -> std::io::Result<Option<Self>> {
        let path = lock_path(database);
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&path)?;
        match file.try_lock() {
            Ok(()) => Ok(Some(Self { _file: file })),
            Err(std::fs::TryLockError::WouldBlock) => Ok(None),
            Err(std::fs::TryLockError::Error(error)) => Err(error),
        }
    }
}

fn lock_path(database: &Path) -> PathBuf {
    let mut name = database.file_name().unwrap_or_default().to_os_string();
    name.push(LOCK_SUFFIX);
    database.with_file_name(name)
}
