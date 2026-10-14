//! 宿主平台探测 — 前端唯一的平台/配色档查询出口。
//!
//! 只回答"运行在什么系统上"与"系统当前是亮档还是暗档", 不涉及 Tauri 能力:
//!   - Windows 自定义菜单栏 (`components/layout/MenuBar`) 据此决定是否接管原生菜单
//!     (原生菜单在透明/分层窗口上无法正确绘制)。
//!   - 亚克力背板补偿 (`settings/acrylicMaterial`) 据此判断系统材料档位是否与
//!     应用主题相反。
//!
//! 两者合用一个出口, 避免同一份 UA 正则散落在视图层与设置层。

/// 是否运行在 Windows 桌面宿主 (Tauri WebView 或浏览器)
export function isWindowsHost(): boolean {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
}

/// 宿主当前的亮暗档 — WebView2 与浏览器都把它对齐到操作系统「应用模式」
/// (Windows 注册表 AppsUseLightTheme)。取不到 matchMedia 时回落 `fallback` —
/// 深色是应用的默认主题, 未知宿主按默认档处理。
export function hostPrefersDark(fallback = true): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return fallback;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}
