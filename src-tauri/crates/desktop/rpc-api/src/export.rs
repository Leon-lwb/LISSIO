//! 文件产物导出 — 命令契约与桌面一致, 落盘策略按出口分化。
//!
//! 桌面 IPC 的导出命令直接写用户选的本地绝对路径 (Tauri 命令层, 不走本 crate)。
//! 本 crate 服务 HTTP-RPC 与 CLI, 两种宿主的落盘能力不同:
//!
//! - **宿主注入了产物暂存区** (Web 出口): 产物写进受管目录, 并经带下载链接的
//!   `notify` 帧交付。浏览器既没有可写路径, 也不能让它指定服务器路径 — 把客户端的
//!   `path` 直接当写盘路径会变成"任何已鉴权客户端可写服务器任意文件"。
//! - **未注入** (无界面 CLI): 调用方就在本机, 沿用显式路径语义。
//!
//! 见 `docs/architecture/web-exit.md` §4。

use std::path::PathBuf;

use backend_host::{ArtifactStaging, BackendHost};
use events::{BackendEventSink, NotifyLevel};
use serde_json::Value;
use waveform::WaveformSeriesSelection;

use crate::args::{RpcError, encode, optional, required};

/// 产物落点。
enum Destination {
    /// 服务端受管暂存区 + 下载 token (Web 出口)。
    Staged { path: PathBuf, url: String },
    /// 显式本地路径 (调用方在本机 — CLI)。
    Local(PathBuf),
}

impl Destination {
    /// 有暂存区就返回受管落点, 否则 `None` (调用方按本地路径语义处理)。
    fn staged(
        staging: Option<&ArtifactStaging>,
        file_name: &str,
    ) -> Option<Result<Self, RpcError>> {
        let staging = staging?;
        Some(match staging.allocate(file_name) {
            Ok((token, path)) => Ok(Self::Staged {
                path,
                // 相对当前服务源 — 浏览器按自己的 origin 解析, 反向代理前缀也保留
                url: format!("/api/v1/download/{token}"),
            }),
            Err(error) => Err(RpcError::text(error)),
        })
    }

    /// 实际写入路径。
    fn write_path(&self) -> String {
        match self {
            Self::Staged { path, .. } | Self::Local(path) => path.to_string_lossy().into_owned(),
        }
    }

    /// 交付提示 — 只有 Web 出口需要 (浏览器拿不到本地路径, 只能点链接下载)。
    fn publish(&self, sink: &dyn BackendEventSink, message: &str) {
        if let Self::Staged { url, .. } = self {
            sink.notify_with_url(NotifyLevel::Info, &format!("{message} — 点击下载"), url);
        }
    }
}

/// 波形原始样本 → CSV (按绝对时间范围)。返回写入行数。
pub async fn export_waveform_csv(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let source: String = required(args, cmd, "source")?;
    let snapshot_id: Option<String> = optional(args, cmd, "snapshot_id")?;
    let start_timestamp_us: u64 = required(args, cmd, "start_timestamp_us")?;
    let end_timestamp_us: u64 = required(args, cmd, "end_timestamp_us")?;
    let selection: WaveformSeriesSelection = required(args, cmd, "selection")?;
    let requested: Option<String> = optional(args, cmd, "path")?;

    let destination = match Destination::staged(
        host.artifacts.as_deref(),
        requested.as_deref().unwrap_or("waveform.csv"),
    ) {
        Some(result) => result?,
        None => Destination::Local(PathBuf::from(
            requested.ok_or_else(|| RpcError::invalid_args(cmd, "缺少字段 path"))?,
        )),
    };

    let rows = control_api::data::export_waveform_csv(
        &host.state,
        &source,
        snapshot_id,
        start_timestamp_us,
        end_timestamp_us,
        selection,
        destination.write_path(),
    )
    .await
    .map_err(RpcError::text)?;

    destination.publish(host.sink.as_ref(), &format!("波形 CSV 已导出 ({rows} 行)"));
    encode(&rows)
}

/// CAN 负载统计 → CSV。
///
/// 返回形状与桌面一致 (字符串): 桌面给本地完整路径, Web 出口给下载 URL —
/// 浏览器无法使用服务器本地路径。
pub async fn export_can_load_csv(
    host: &BackendHost,
    cmd: &str,
    args: &Value,
) -> Result<Value, RpcError> {
    let node_id: String = required(args, cmd, "node_id")?;
    let bitrate_bps: Option<u32> = optional(args, cmd, "bitrate_bps")?;

    let bitrate = app::can_bitrate_bps(&host.state, &node_id, bitrate_bps);
    let snapshot = host.state.can_load_stats.lock().snapshot(bitrate);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let file_name = control_api::can_export::can_load_csv_file_name(now);
    let csv = control_api::can_export::format_can_load_csv(
        &snapshot,
        bitrate,
        &control_api::can_export::can_load_export_time(now),
    );

    let destination = match Destination::staged(host.artifacts.as_deref(), &file_name) {
        Some(result) => result?,
        // CLI: 与桌面同样的语义 — 产物落在当前目录
        None => {
            let dir = std::env::current_dir()
                .map_err(|error| RpcError::text(format!("无法解析当前目录: {error}")))?;
            Destination::Local(dir.join(&file_name))
        }
    };

    let path = destination.write_path();
    tokio::fs::write(&path, csv.as_bytes())
        .await
        .map_err(|error| RpcError::text(format!("写入 CSV 失败: {error}")))?;

    destination.publish(
        host.sink.as_ref(),
        &format!("CAN 负载 CSV 已导出 ({file_name})"),
    );

    encode(&match destination {
        Destination::Staged { url, .. } => url,
        Destination::Local(path) => path.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
#[path = "export_tests.rs"]
mod tests;
