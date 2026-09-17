//! GUI 专有宿主函数 — 依赖 `AppHandle` 的窗口与退出逻辑。
//!
//! 层级: L5 组合根。与此前的去 Tauri 化方向一致, 这些函数不进入 `app` (L3)
//! 等共享层: 无界面宿主 (backend-cli) 不会启动页兜底, 退出 flush 直接调
//! `app::stop_recording` + `app::flush_workspace`。

use app::AppState;
use tauri::Manager;

/// 退出 flush: 停止录制并把未落盘的工作区变更同步写盘。
pub fn flush_workspace_on_exit(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    app::stop_recording(&state);
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));
    app::flush_workspace(&state, &dir);
}

/// 启动页兜底: 前端应在初始化完成后调用 close_splashscreen 关闭启动页;
/// 若前端异常迟迟未调用, 超时强制切换, 防止永远卡在启动页
pub fn spawn_splashscreen_fallback(app: &tauri::AppHandle) {
    let fallback_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(10));
        if let Some(splash) = fallback_handle.get_webview_window("splashscreen") {
            log::warn!("splashscreen fallback: force closing after timeout");
            let _ = splash.close();
        }
        if let Some(main) = fallback_handle.get_webview_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
        }
    });
}
