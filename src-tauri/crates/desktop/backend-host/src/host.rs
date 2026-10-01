//! 后端宿主持有装配 — Tauri 组合根与全部无界面出口共用的装配结果。
//!
//! 顺序与 GUI 组合根 `.setup` 保持一致: 装配 → 观察者/引擎/发现注入 →
//! 可选工作区恢复 → `signal_restore_done` → 录制与后台任务。事件经
//! [`events::BackendEventSink`] 端口注入, 因此同一份装配既能服务 IPC 前端,
//! 也能服务 stderr JSON-lines (CLI) 或 WebSocket (HTTP 出口)。
//!
//! 本模块不含 Tauri: `Toolbox` 只是从 [`AppState`] 提取的 `Arc` 句柄切片,
//! 各出口 (IPC 命令层 / CLI 子命令 / HTTP-RPC) 操作的是同一份运行状态。

use std::path::PathBuf;
use std::sync::Arc;

use app::AppState;
use control_api::Toolbox;
use events::EventSinkHandle;

/// 已装配的后端宿主 — 一次性子命令、常驻服务与进程内测试共用。
pub struct BackendHost {
    /// 应用全局状态。
    pub state: AppState,
    /// 控制能力切片 (与 `state` 共享同一批 `Arc` 句柄)。
    pub toolbox: Toolbox,
    /// AI/MCP host，共享相同的 Toolbox、事件端口与配置目录。
    pub ai: Arc<ai_host::AiHost>,
    /// 出口事件端口 (stderr / Tauri / WebSocket 广播)。
    pub sink: EventSinkHandle,
    /// 配置目录 (workspace.json / settings.json / recordings/ 所在处)。
    pub config_dir: PathBuf,
    /// 导出产物暂存区 — 只有 Web 出口注入 (浏览器没有可写路径); 其余出口为
    /// `None`, 导出命令沿用显式本地路径语义。见 [`crate::ArtifactStaging`]。
    pub artifacts: Option<Arc<crate::ArtifactStaging>>,
}

/// 装配后端宿主 (适配器注册 + 点位观察者 + 可选工作区恢复 + 后台任务)。
///
/// `config_dir` 为 `None` 时按 [`crate::resolve_config_dir`] 解析 (显式参数 >
/// `LISSIO_CONFIG_DIR` > 平台默认), 保证 GUI 与各无界面出口读写同一份状态。
///
/// # Errors
/// 目前仅在配置目录无法创建 (录制数据库落地) 时可能失败; 恢复失败按"无持久化"
/// 处理, 不中断装配。
pub async fn assemble(
    config_dir: Option<PathBuf>,
    restore: bool,
    sink: EventSinkHandle,
) -> Result<BackendHost, String> {
    let config_dir = crate::resolve_config_dir(config_dir);
    let (runtime, drivers) = crate::build_acquisition_runtime();
    let state = AppState::with_acquisition(runtime);
    state.install_model_catalog(std::sync::Arc::new(crate::build_model_catalog(&drivers)));
    state.install_drivers(drivers.clone());
    crate::install_point_observer(&state);
    crate::install_envelope_engine(&state);
    crate::install_serial_discovery(&state);
    if restore {
        let restored = crate::restore_workspace(&state, &config_dir, Some(sink.as_ref())).await;
        log::info!(
            "workspace restore: {}",
            if restored { "loaded" } else { "none" }
        );
    }
    state.signal_restore_done();
    // 用户设置回放: 录制总开关 (默认开)。桌面壳与 Web 出口写的是同一份
    // settings.json, 三个组合根因此行为一致 — 无界面出口也能被用户关掉。
    let recording_enabled = crate::SettingsStore::new(&config_dir).recording_enabled();
    // 录制会话与后台任务由 spawn_backend_tasks 统一启动 (与 GUI 组合根一致)
    app::spawn_backend_tasks(
        &state,
        sink.clone(),
        config_dir.clone(),
        recording_enabled,
        &|future| {
            tokio::spawn(future);
        },
    );
    let toolbox = Toolbox::from_state(&state);
    let ai = Arc::new(ai_host::AiHost::new(
        config_dir.clone(),
        toolbox.clone(),
        sink.clone(),
    ));
    Ok(BackendHost {
        state,
        toolbox,
        ai,
        sink,
        config_dir,
        // Web 出口装配后自行注入暂存区 (见 `backend_server::serve`)
        artifacts: None,
    })
}

/// 收尾 — 停录制并把未落盘的工作区变更同步写盘 (幂等)。
pub fn teardown(host: &BackendHost) {
    crate::shutdown(&host.state, &host.config_dir);
}
