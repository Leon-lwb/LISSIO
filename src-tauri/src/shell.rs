//! Desktop shell-only commands and startup helpers.

use tauri::{Manager, Runtime, WebviewWindow};

/// Open the current webview developer tools.
#[tauri::command]
pub fn inspect_element<R: Runtime>(window: WebviewWindow<R>) {
    window.open_devtools();
}

/// 亚克力 tint 的透明度 (Windows 10 `ACCENT_ENABLE_ACRYLICBLURBEHIND` 路径)。
///
/// 只影响 Windows 10 1809 - 11 22H1: 11 22H2+ 的系统背板 (`DWMSBT_TRANSIENTWINDOW`)
/// 不接受应用染色, 材料档位由系统亮暗设置决定 (见 docs/reviews/records/2026-10-14-windows-acrylic-backdrop.md)。
/// 取 0x40 而不是 0: DWM 把 alpha 0 视为"未设置"并强制成 1 (window-vibrancy 内部也这样兜底),
/// 那样背板会完全失去应用主题色, 只剩系统材料本身。
#[cfg(any(target_os = "windows", test))]
const ACRYLIC_TINT_ALPHA: u8 = 0x40;

/// 把应用主题的窗口底色 `[r, g, b]` 转成 DWM 的 GradientColor。
///
/// 通道数不足时返回 `None`, 交给 DWM 用它自己的默认 tint —— 前端的主题色理论上都是
/// `#rrggbb`, 但自定义 CSS 主题仍可能给出 `var()`/`color-mix()`, 那种输入不该被猜成黑色。
#[cfg(any(target_os = "windows", test))]
const fn acrylic_tint(rgb: Option<&[u8]>) -> Option<(u8, u8, u8, u8)> {
    match rgb {
        Some([r, g, b]) => Some((*r, *g, *b, ACRYLIC_TINT_ALPHA)),
        _ => None,
    }
}

/// Enable or disable the platform blur material and keep the native window theme in sync.
///
/// `dark` is the polarity of the active application theme. Windows draws every window frame
/// light regardless of the system setting (`DWMWA_USE_IMMERSIVE_DARK_MODE` defaults to light
/// "for compatibility reasons"), so a decorated window would otherwise show a light title bar
/// and frame above a dark application theme. `tint` is the theme's window background as
/// `[r, g, b]`: only the Windows 10 composition-attribute path forwards it to DWM, where the
/// material tint is application-owned; the Windows 11 system backdrop ignores it.
#[tauri::command]
pub fn set_window_acrylic<R: Runtime>(
    window: WebviewWindow<R>,
    enabled: bool,
    dark: Option<bool>,
    tint: Option<Vec<u8>>,
) {
    let _ = window.clone().run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        {
            use window_vibrancy::{
                NSVisualEffectMaterial, NSVisualEffectState, apply_vibrancy, clear_vibrancy,
            };
            let _ = (dark, tint);
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
            use window_vibrancy::{apply_acrylic, apply_blur, clear_acrylic, clear_blur};
            // 边框档位跟随应用主题; tao 对同一档位是幂等的 (值未变时直接返回)。
            if let Some(dark) = dark
                && let Err(error) = window.set_theme(Some(if dark {
                    tauri::Theme::Dark
                } else {
                    tauri::Theme::Light
                }))
            {
                log::warn!("set_window_acrylic: frame theme sync failed: {error}");
            }
            let tint = acrylic_tint(tint.as_deref());
            let result = if enabled {
                // 系统背板由 window-vibrancy 按版本选择: 11 22H2+ 走 DwmSetWindowAttribute,
                // 10 1809+ 走 SetWindowCompositionAttribute。它的版本门限是 22523, 低于
                // MS 文档给系统背板的最低版本 22621, 因此 22523-22620 这段会调用失败 ——
                // 那时退回 SWCA 模糊, 至少保住磨砂, 而不是留下一块纯透明窗口。
                apply_acrylic(&window, tint).or_else(|error| {
                    log::warn!(
                        "set_window_acrylic: system backdrop unavailable ({error}), falling back to blur"
                    );
                    apply_blur(&window, tint)
                })
            } else {
                // 两条路径都要清: 开启期间可能落到上面的模糊兜底, 只清 acrylic 会留下模糊。
                let acrylic = clear_acrylic(&window);
                let blur = clear_blur(&window);
                acrylic.and(blur)
            };
            if let Err(error) = result {
                log::warn!("set_window_acrylic failed: {error}");
            } else {
                log::debug!("set_window_acrylic: enabled={enabled} dark={dark:?} tint={tint:?}");
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = (&window, enabled, dark, tint);
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

#[cfg(test)]
#[path = "shell_tests.rs"]
mod tests;
