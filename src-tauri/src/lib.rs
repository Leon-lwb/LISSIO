//! `lissio` desktop shell composition root.
//!
//! Product logic lives in the independently running `lissio-server`. This crate only owns
//! windows, menus, updates, platform plugins, and the supervised server sidecar.

mod logging;
mod shell;
mod sidecar;

pub use menu_shell::{build_menu, on_menu_event};
pub use shell::{
    close_splashscreen, inspect_element, open_settings_folder, set_window_acrylic, show_main_window,
};
pub use sidecar::{backend_sidecar_info, backend_sidecar_open_logs, backend_sidecar_restart};
// Tauri command macros are exported as hidden companion macros and require a glob import at the
// composition root so `generate_handler!` can resolve them.
pub use update_flow::*;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::large_stack_frames)]
pub fn run() {
    let context = tauri::generate_context!();
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                // 目标在插件初始化前就定好: 日志文件写不出来时必须降级而不是中止启动,
                // 见 `logging` 模块头注。
                .targets(logging::targets(
                    &context.config().identifier,
                    &context.package_info().name,
                ))
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(PendingUpdate(std::sync::Mutex::default()))
        .manage(sidecar::SidecarManager::default())
        .setup(|app| {
            // 日志后端此刻已就绪: 把文件目标的降级/禁用原因补记进日志本身
            logging::report_degradation();

            if let Err(error) = app.state::<sidecar::SidecarManager>().start(app.handle()) {
                log::error!("sidecar startup failed: {error}");
            }

            let menu = build_menu(app)?;
            #[cfg(not(target_os = "windows"))]
            app.set_menu(menu)?;
            #[cfg(target_os = "windows")]
            let _ = menu;

            shell::spawn_splashscreen_fallback(app.handle());
            Ok(())
        })
        .on_menu_event(|app, event| on_menu_event(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![
            inspect_element,
            set_window_acrylic,
            show_main_window,
            close_splashscreen,
            open_settings_folder,
            check_update,
            download_and_install_update,
            backend_sidecar_info,
            backend_sidecar_restart,
            backend_sidecar_open_logs,
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<sidecar::SidecarManager>().stop();
            }
        });
}
