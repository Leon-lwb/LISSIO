//! Desktop shell-only commands and startup helpers.

use tauri::{Manager, Runtime, WebviewWindow};

/// Open the current webview developer tools.
#[tauri::command]
pub fn inspect_element<R: Runtime>(window: WebviewWindow<R>) {
    window.open_devtools();
}

/// Enable or disable the platform blur effect for the main window.
#[tauri::command]
pub fn set_window_acrylic<R: Runtime>(window: WebviewWindow<R>, enabled: bool) {
    let _ = window.clone().run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        {
            use window_vibrancy::{
                NSVisualEffectMaterial, NSVisualEffectState, apply_vibrancy, clear_vibrancy,
            };
            let result = if enabled {
                apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::FullScreenUI,
                    Some(NSVisualEffectState::FollowsWindowActiveState),
                    None,
                )
            } else {
                clear_vibrancy(&window).map(|_| ())
            };
            if let Err(error) = result {
                log::warn!("set_window_acrylic failed: {error}");
            }
        }
        #[cfg(target_os = "windows")]
        {
            use window_vibrancy::{apply_acrylic, clear_acrylic};
            let result = if enabled {
                apply_acrylic(&window, None::<(u8, u8, u8, u8)>)
            } else {
                clear_acrylic(&window)
            };
            if let Err(error) = result {
                log::warn!("set_window_acrylic failed: {error}");
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = (&window, enabled);
    });
}

/// Show and focus the main window without closing the splash screen.
#[tauri::command]
pub fn show_main_window(app: tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main")
        && let Err(error) = main.show().and_then(|()| main.set_focus())
    {
        log::warn!("show main window failed: {error}");
    }
}

/// Close the splash screen and show the main window.
#[tauri::command]
pub fn close_splashscreen(app: tauri::AppHandle) {
    if let Some(splash) = app.get_webview_window("splashscreen")
        && let Err(error) = splash.close()
    {
        log::warn!("close splashscreen failed: {error}");
    }
    show_main_window(app);
}

/// Open the application's configuration directory in the system file manager.
#[tauri::command]
pub fn open_settings_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|error| error.to_string())
}

/// Prevent a frontend initialization error from leaving the splash screen open forever.
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
