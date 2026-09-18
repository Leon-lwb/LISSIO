//! `lissio` desktop shell composition root.
//!
//! Product logic lives in the independently running `lissio-server`. This crate only owns
//! windows, menus, updates, platform plugins, and the supervised server sidecar.

mod shell;
mod sidecar;

pub use menu_shell::{build_menu, on_menu_event};
pub use shell::{close_splashscreen, inspect_element, set_window_acrylic, show_main_window};
pub use sidecar::{backend_sidecar_info, backend_sidecar_open_logs, backend_sidecar_restart};
// Tauri command macros are exported as hidden companion macros and require a glob import at the
// composition root so `generate_handler!` can resolve them.
pub use update_flow::*;

use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[allow(clippy::large_stack_frames)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Webview),
                ])
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(PendingUpdate(std::sync::Mutex::default()))
        .manage(sidecar::SidecarManager::default())
        .setup(|app| {
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
            check_update,
            download_and_install_update,
            backend_sidecar_info,
            backend_sidecar_restart,
            backend_sidecar_open_logs,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<sidecar::SidecarManager>().stop();
            }
        });
}
