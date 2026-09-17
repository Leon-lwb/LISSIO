//! `can_load` — CAN 负载统计 Tauri 命令。
//!
//! CSV 格式化 (`format_can_load_csv` / 文件名 / 本地时间换算) 已下沉到
//! [`control_api::can_export`] (P3): Web 出口的同名命令与本文件共用同一份实现。
//! 本文件只保留命令签名与"桌面写用户下载目录"这一出口专有的落盘策略。

use app::AppState;
use can::CanLoadSnapshot;
use data_model::Result;
use tauri::{AppHandle, Manager, State};

use control_api::can_export;

/// 获取 CAN 负载统计快照
///
/// `node_id`: 用于自动解析波特率的设备节点 id
/// `bitrate_bps`: 可选手动覆盖波特率; None/0 = 自动从 TransportConfig 读取
#[tauri::command]
pub async fn get_can_load_stats(
    state: State<'_, AppState>,
    node_id: String,
    bitrate_bps: Option<u32>,
) -> Result<CanLoadSnapshot> {
    let bitrate = app::can_bitrate_bps(&state, &node_id, bitrate_bps);
    let load_stats = state.can_load_stats.lock();
    Ok(load_stats.snapshot(bitrate))
}

/// 设置 CAN 负载统计滑动窗口大小 (微秒)
///
/// 例如 1_000_000 = 1 秒, 100_000 = 100ms
#[tauri::command]
pub async fn set_can_load_window(state: State<'_, AppState>, window_us: u64) -> Result<()> {
    state.can_load_stats.lock().set_window_us(window_us);
    Ok(())
}

/// 清空 CAN 负载统计
#[tauri::command]
pub async fn clear_can_load_stats(state: State<'_, AppState>) -> Result<()> {
    state.can_load_stats.lock().clear();
    Ok(())
}

/// 获取指定设备节点的当前 CAN 波特率 (从会话配置提取, 用于前端 UI 默认值)
///
/// 返回 (bps, source) — source 描述来源 ("slcan" / "candle" / "default")
#[tauri::command]
pub async fn get_current_can_bitrate(
    state: State<'_, AppState>,
    node_id: String,
) -> Result<(u32, String)> {
    let (bps, source) = app::can_bitrate_with_source(&state, &node_id);
    Ok((bps, source.to_string()))
}

/// 导出 CAN 负载统计为 CSV 文件
///
/// 自动保存到用户下载目录, 文件名格式: `vofa-can-load-YYYYMMDD-HHMMSS.csv`
///
/// CSV 结构:
/// - 元信息头 (# 开头): 导出时间 / 波特率 / 窗口大小
/// - Section: History — 时间戳, 负载率, 帧率
/// - Section: Per-ID — ID, 扩展帧, 帧数, 总位数, 总字节数
/// - Section: Per-ID History — ID, 扩展帧, 时间戳, 负载率
///
/// 返回完整文件路径
#[tauri::command]
pub async fn export_can_load_csv(
    state: State<'_, AppState>,
    app: AppHandle,
    node_id: String,
    bitrate_bps: Option<u32>,
) -> Result<String> {
    use std::io::Write;

    let bitrate = app::can_bitrate_bps(&state, &node_id, bitrate_bps);
    let snap = state.can_load_stats.lock().snapshot(bitrate);

    // 生成时间戳 (本地时间, 不依赖 chrono)
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let filename = can_export::can_load_csv_file_name(now);
    let csv =
        can_export::format_can_load_csv(&snap, bitrate, &can_export::can_load_export_time(now));

    // 选择保存路径: 优先 Downloads, 失败则用当前目录
    let path = match app.path().download_dir() {
        Ok(d) => d.join(&filename),
        Err(_) => std::env::current_dir()
            .map(|d| d.join(&filename))
            .map_err(|e| data_model::Error::Config(error::ConfigError::DownloadDir(e)))?,
    };

    let mut file = std::fs::File::create(&path)?;
    file.write_all(csv.as_bytes())?;

    log::info!("CAN 负载 CSV 已导出: {}", path.display());
    Ok(path.to_string_lossy().to_string())
}
