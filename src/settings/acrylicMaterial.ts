//! 亚克力背板材料模型 — 应用主题与系统材料对不齐时, 由应用底色决定背板观感。
//!
//! 背景: Windows 的窗口背板由 DWM 的系统材料绘制, 应用只能选"要不要", 不能给它染色:
//!   - Windows 11 22H2+ (`DWMSBT_TRANSIENTWINDOW`, Desktop Acrylic): 材料的亮暗/色温
//!     跟随系统的亮暗档, `DWMWA_USE_IMMERSIVE_DARK_MODE` 按文档只作用于窗口边框, 不影响
//!     材料本身 (见 docs/reviews/records/2026-10-14-windows-acrylic-backdrop.md)。
//!   - Windows 10 1809-22H1 (`ACCENT_ENABLE_ACRYLICBLURBEHIND`): tint 由应用给定
//!     (见 `src-tauri/src/shell.rs` 的 tint 参数), 但 alpha 只能叠加, 不能反转材料的底色。
//! 于是"应用深色 + 系统浅色"这类反档组合下, 再低的底色覆盖率都会被材料本身抬亮, 背板
//! 变成灰白板 —— 界面文字对比度随之塌陷。
//!
//! 结论: 反档时只能让应用自己的底色压过材料。补偿取 [补偿强度] 的凸组合
//! (`alpha + (1 - alpha) * 强度`), 它保留各 token 之间的层级顺序 (窗口最透、面板头最实),
//! 而不是把所有 token 抬到同一个下限把层级压平。

import { hostPrefersDark, isWindowsHost } from '../lib/platform/host';

/// 基准透明度对应的 acrylicOpacity 设置值
export const ACRYLIC_BASE_OPACITY = 0.6;

/// 反档补偿强度 — 0 表示不补偿, 1 表示全不透明。
/// 0.65 下默认档 (acrylicOpacity = 0.6) 的材料占比约 12%-17%: 磨砂感仍在, 观感由主题决定。
export const MATERIAL_MISMATCH_COMPENSATION = 0.65;

/// 主题背景色判为"暗档"的相对亮度阈值
const DARK_LUMINANCE_THRESHOLD = 0.5;

/// 宿主是否需要"材料反档补偿"。
///
/// 只含 Windows: 该平台系统材料的亮暗档无法由应用指定。macOS 的原生 vibrancy 同理由
/// 系统外观决定, 但补偿后的观感尚未在真机验证, 因此暂不纳入 —— 见评审记录的 Follow-ups。
export function hostBorrowsSystemMaterial(): boolean {
  return isWindowsHost();
}

/// `#rgb` / `#rrggbb` → `[r, g, b]`; 非 hex (var()/color-mix()/rgb()) 返回 null
export function parseHexColor(color: string): [number, number, number] | null {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color.trim());
  if (!match) return null;
  const hex = match[1].length === 3
    ? match[1].split('').map((char) => char + char).join('')
    : match[1];
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/// 主题背景色是否属于暗档 (WCAG 相对亮度的线性近似)。
/// 取不到颜色时回落 `fallback` —— 深色是应用的默认主题, 未知输入按默认档处理。
export function isDarkBackground(color: string, fallback = true): boolean {
  const rgb = parseHexColor(color);
  if (!rgb) return fallback;
  const [r, g, b] = rgb;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < DARK_LUMINANCE_THRESHOLD;
}

/// 系统材料是否与应用主题反档 — 补偿的唯一触发条件
export function materialMismatchesTheme(background: string, fallbackDark = true): boolean {
  return isDarkBackground(background, fallbackDark) !== hostPrefersDark();
}

/// 亚克力模式下背景 token 的最终 alpha
///
/// - `baseAlpha`: 该 token 在 `acrylicOpacity = ACRYLIC_BASE_OPACITY` 时的透明度
/// - `opacity`:   `appearance.acrylicOpacity` (0.1-1.0)
/// - `compensate`: 反档补偿是否生效 (见 [`materialMismatchesTheme`])
export function acrylicTokenAlpha(baseAlpha: number, opacity: number, compensate: boolean): number {
  const clamped = Math.min(1, Math.max(0.1, opacity));
  const alpha = Math.min(1, (baseAlpha / ACRYLIC_BASE_OPACITY) * clamped);
  const resolved = compensate ? alpha + (1 - alpha) * MATERIAL_MISMATCH_COMPENSATION : alpha;
  // 四舍五入到 1e-4: CSS 里 0.8250000000000001 这种浮点尾数没有意义, 还会让快照抖动
  return Math.round(resolved * 10000) / 10000;
}
