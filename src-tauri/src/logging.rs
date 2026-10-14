//! 日志目标组装 — 把"文件能不能写"在插件初始化之前问清楚。
//!
//! `tauri-plugin-log` 把目录解析、目录创建和文件打开全放在插件初始化里
//! (`acquire_logger`): 任何一步 io 失败都会让 `tauri::Builder::build()` 返回
//! `PluginInitialization("log", …)`, 应用连窗口都起不来 —— 日志后端不该拦住启动。
//! 这里先按插件会用的同一个路径做一次等价预检:
//!
//!   1. 主目录 (与 tauri `PathResolver::app_log_dir` 同规则) 可写 → 显式交给插件;
//!   2. 否则退到系统临时目录下的 `lissio-logs`;
//!   3. 再不行就只留 stdout / Webview, 并把原因报出来。
//!
//! 显式传 `TargetKind::Folder` 而不是 `TargetKind::LogDir`, 是为了让"预检的路径"和
//! "插件真正写入的路径"必然是同一个 —— 用 `LogDir` 的话两边各解析一次, 预检通过也可能
//! 在插件里失败。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri_plugin_log::{Target, TargetKind};

/// 主目录不可写时的兜底目录名 (落在系统临时目录下)
const FALLBACK_DIR_NAME: &str = "lissio-logs";

/// 降级说明 — logger 就绪之前没有日志可写, 先存下来, 由 [`report_degradation`] 补记
static DEGRADATION: OnceLock<String> = OnceLock::new();

/// 已确定的日志目录 — 侧车日志 (`lissio-server.log`) 与插件日志必须落在同一个目录里,
/// 而"哪个目录真的可写"只有这里知道, 见 [`resolved_log_dir`]
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// 组装桌面壳的日志目标: stdout + [日志文件] + Webview。
///
/// `file_name` 与 `identifier` 都由 `tauri::generate_context!()` 给出: 前者是
/// `package_info().name` (即 `productName`), 正是插件在 `file_name: None` 时会取的名字 ——
/// 显式传一遍, 免得预检的文件名和真实写入的文件名分叉。
pub fn targets(identifier: &str, file_name: &str) -> Vec<Target> {
    let mut targets = vec![Target::new(TargetKind::Stdout)];
    match plan(identifier, file_name) {
        Ok(planned) => {
            let _ = LOG_DIR.set(planned.dir.clone());
            if let Some(note) = planned.note {
                eprintln!("lissio: {note}");
                let _ = DEGRADATION.set(note);
            }
            targets.push(Target::new(TargetKind::Folder {
                path: planned.dir,
                file_name: Some(file_name.to_owned()),
            }));
        }
        Err(reason) => {
            eprintln!("lissio: 文件日志已禁用: {reason}");
            let _ = DEGRADATION.set(format!("文件日志已禁用: {reason}"));
        }
    }
    targets.push(Target::new(TargetKind::Webview));
    targets
}

/// 已确定的文件日志目录 — 主目录不可写时这里是兜底目录。
///
/// `sidecar` 用它决定 `lissio-server.log` 的位置: 两边各自解析一次的话, 主目录不可写时
/// 插件已经降级到兜底目录, 侧车却还去开主目录, 于是"日志没了 + 后端起不来"一起发生。
/// 返回 `None` 表示连兜底目录都写不了 (文件日志已禁用), 调用方按自己的策略处理。
pub fn resolved_log_dir() -> Option<PathBuf> {
    LOG_DIR.get().cloned()
}

/// 把降级原因写进已经就绪的 logger (stderr 在正式版里没人看得到)
pub fn report_degradation() {
    if let Some(reason) = DEGRADATION.get() {
        log::warn!("{reason}");
    }
}

/// 已确定的文件目标: 目录, 以及降级到兜底目录时的说明
struct FileTargetPlan {
    dir: PathBuf,
    note: Option<String>,
}

/// 主目录 → 兜底目录的降级链
fn plan(identifier: &str, file_name: &str) -> Result<FileTargetPlan, String> {
    let primary = app_log_dir(identifier).ok_or_else(|| "无法解析平台数据目录".to_owned())?;
    plan_for(
        primary,
        std::env::temp_dir().join(FALLBACK_DIR_NAME),
        file_name,
    )
}

/// [`plan`] 的可测版本 — 两个候选目录都由调用方给出
fn plan_for(
    primary: PathBuf,
    fallback: PathBuf,
    file_name: &str,
) -> Result<FileTargetPlan, String> {
    let primary_error = match prepare(&primary, file_name) {
        Ok(()) => {
            return Ok(FileTargetPlan {
                dir: primary,
                note: None,
            });
        }
        Err(error) => error,
    };
    match prepare(&fallback, file_name) {
        Ok(()) => {
            let note = format!(
                "日志目录 {} 不可写 ({primary_error}), 本次写入 {}",
                primary.display(),
                fallback.display()
            );
            Ok(FileTargetPlan {
                dir: fallback,
                note: Some(note),
            })
        }
        Err(fallback_error) => Err(format!(
            "{} 不可写 ({primary_error}); 兜底 {} 也不可写 ({fallback_error})",
            primary.display(),
            fallback.display()
        )),
    }
}

/// 预检: 建目录 + 目标文件不是目录 + 试开一次。
///
/// 试开用 `create + append`, 与插件默认的 `FileOpenStrategy::Append` 同形 —— "只读文件 /
/// 权限被拒 / 路径被占用"都会在这里暴露, 而不是等到 `build()` 里崩。
fn prepare(dir: &Path, file_name: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("建目录 {} 失败: {error}", dir.display()))?;
    let file = dir.join(file_name).with_extension("log");
    if file.is_dir() {
        return Err(format!("{} 是目录而不是日志文件", file.display()));
    }
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
        .map_err(|error| format!("打开 {} 失败: {error}", file.display()))?;
    Ok(())
}

/// 平台日志目录 — 与 tauri 2.12 `PathResolver::app_log_dir` (src/path/desktop.rs) 同规则:
/// macOS 是 `~/Library/Logs/<identifier>`, 其它桌面是 `<data_local_dir>/<identifier>/logs`。
/// 基准目录交给 `dirs` 解析 —— 与 tauri 用的是同一个 crate, 免得两处对平台约定各解释一套。
fn app_log_dir(identifier: &str) -> Option<PathBuf> {
    let shape = log_dir_shape();
    let base = match shape {
        LogDirShape::HomeLibraryLogs => dirs::home_dir(),
        LogDirShape::DataLocal => dirs::data_local_dir(),
    };
    base.map(|base| log_dir(&base, identifier, shape))
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum LogDirShape {
    /// macOS: `$HOME/Library/Logs/<identifier>`
    HomeLibraryLogs,
    /// Windows / Linux: `<data_local_dir>/<identifier>/logs`
    DataLocal,
}

const fn log_dir_shape() -> LogDirShape {
    if cfg!(target_os = "macos") {
        LogDirShape::HomeLibraryLogs
    } else {
        LogDirShape::DataLocal
    }
}

fn log_dir(base: &Path, identifier: &str, shape: LogDirShape) -> PathBuf {
    match shape {
        LogDirShape::HomeLibraryLogs => base.join("Library").join("Logs").join(identifier),
        LogDirShape::DataLocal => base.join(identifier).join("logs"),
    }
}

#[cfg(test)]
#[path = "logging_tests.rs"]
mod tests;
