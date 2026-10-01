//! 运行时装配 — 组合根调用的后台任务启动与退出 flush
//!
//! 层级: L3 app。任务体本身不含 Tauri: 工作区防抖落盘、录制启动、3 个推送
//! ticker、自动发送调度都只依赖 [`AppState`] 与 [`EventSinkHandle`], 由组合根
//! 提供的 [`TaskSpawner`] 孵化 (Tauri 组合根用 `tauri::async_runtime::spawn`,
//! 无界面 CLI 用 `tokio::spawn`)。GUI 专有的退出 flush 与启动页兜底在组合根。

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;

use events::EventSinkHandle;

use crate::app_state::AppState;
use crate::{SourceGraphs, WorkspaceState, collect_workspace_file, save_workspace};
use crate::{send_scheduler_ticker, spectrum_ticker, text_output_ticker, textout_sender_ticker};

/// 任务孵化器 — 把任务体交给组合根的运行时 (Tauri / tokio)。
pub type TaskSpawner = dyn Fn(Pin<Box<dyn Future<Output = ()> + Send + 'static>>) + Send + Sync;

/// 启动全部后端后台任务: 录制会话 / 工作区防抖落盘 / 文本输出 & TextOut & 频谱
/// ticker / 自动发送调度。
///
/// `config_dir`: workspace.json 与 recordings/ 所在目录 (app config dir)。
/// `recording_enabled`: 用户设置里的录制总开关 (默认开)。关闭时**不建立任何
/// DuckDB 连接** — 只登记坐标, 采集与其它后台任务照常。
pub fn spawn_backend_tasks(
    state: &AppState,
    sink: EventSinkHandle,
    config_dir: PathBuf,
    recording_enabled: bool,
    spawn: &TaskSpawner,
) {
    start_recording(state, &config_dir, recording_enabled);
    spawn_workspace_autosave(state, config_dir, spawn);
    spawn_push_tickers(state, sink, spawn);
}

/// 启动录制会话 (工作区尚未启动, 会话以 paused 开局 = recorder 就绪但未写入)。
///
/// 开关关闭时只调用 [`recording::RecordingHub::disable_at`]: 不建目录、不打开
/// 数据库文件, 用户可以在设置里随时打开。
pub fn start_recording(state: &AppState, config_dir: &Path, enabled: bool) {
    let path = config_dir.join("recordings").join("acquisition.duckdb");
    let recording = state.eval_state().recording;
    let limits = recording::RecordingLimits::default();
    if !enabled {
        recording.disable_at(path, limits);
        log::info!("recording disabled by settings: no database connection opened");
        return;
    }
    // 上次会话没有写入任何数据时继续写同一会话, 避免每次启动都新增空会话
    match recording.start(path, Vec::new(), limits, recording::SessionState::Paused) {
        Ok(session) => log::info!("recording session started: {}", session.id),
        Err(error) => log::error!("recording unavailable: {error}"),
    }
}

/// 工作区防抖落盘任务 — 图提交 / 位置上报 / tab 变更置 dirty,
/// 此任务周期性检查并整体覆盖写 (800ms 合并连发编辑)。
pub async fn workspace_autosave_loop(
    workspace: WorkspaceState,
    source_graphs: SourceGraphs,
    dir: PathBuf,
    mut restore_done: tokio::sync::watch::Receiver<bool>,
) {
    // 启动恢复为后台异步任务 — 落盘先等恢复完成门, 避免把恢复中途的
    // 半成品状态 (部分 tab 图已应用) 写回 workspace.json
    while !*restore_done.borrow_and_update() {
        if restore_done.changed().await.is_err() {
            break;
        }
    }
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        let should_save = {
            let mut w = workspace.lock();
            if w.dirty {
                w.dirty = false;
                true
            } else {
                false
            }
        };
        if should_save {
            let file = collect_workspace_file(&workspace, &source_graphs);
            if let Err(e) = save_workspace(&dir, &file) {
                log::warn!("工作区落盘失败: {e}");
            }
        }
    }
}

/// 启动字符串输出 (30 FPS) / TextOut 发送 / 频谱分析 / 自动发送调度 ticker。
fn spawn_push_tickers(state: &AppState, sink: EventSinkHandle, spawn: &TaskSpawner) {
    // 启动字符串输出 ticker (30 FPS 推送给 TextDisplay)
    let eval_state_for_text = state.eval_state();
    spawn(Box::pin(text_output_ticker(eval_state_for_text)));

    // 启动 TextOut 发送 ticker (图内字符串限速写回目标 Transport 的 tx)
    let eval_state_for_textout = state.eval_state();
    let transport_for_textout = std::sync::Arc::clone(&state.data_plane.transport);
    spawn(Box::pin(textout_sender_ticker(
        eval_state_for_textout,
        transport_for_textout,
    )));

    // 启动频谱分析 ticker (30 FFT 计算 + 推送 SpectrumBatch)
    let eval_state_for_spectrum = state.eval_state();
    spawn(Box::pin(spectrum_ticker(eval_state_for_spectrum)));

    // 启动后台自动发送调度 ticker (Timer/OnChange; 手动发送走统一内核命令)
    spawn(Box::pin(send_scheduler_ticker(
        sink,
        state.data_plane.clone(),
        std::sync::Arc::clone(&state.source_graphs),
    )));
}

fn spawn_workspace_autosave(state: &AppState, dir: PathBuf, spawn: &TaskSpawner) {
    let workspace = state.workspace.clone();
    let source_graphs = std::sync::Arc::clone(&state.source_graphs);
    let restore_done = state.subscribe_restore_done();
    spawn(Box::pin(workspace_autosave_loop(
        workspace,
        source_graphs,
        dir,
        restore_done,
    )));
}

/// 停止录制会话 (退出/关闭时调用; 幂等)。
pub fn stop_recording(state: &AppState) {
    if let Err(error) = state.eval_state().recording.stop() {
        log::error!("recording shutdown failed: {error}");
    }
}

/// 把未落盘的工作区变更同步写盘 (防抖任务最长 800ms 间隔, 退出前补齐)。
pub fn flush_workspace(state: &AppState, dir: &Path) {
    let ws = &state.workspace;
    if ws.lock().dirty {
        let file = collect_workspace_file(ws, &state.source_graphs);
        if let Err(e) = save_workspace(dir, &file) {
            log::warn!("工作区退出落盘失败: {e}");
        }
    }
}
