//! Normalize saved default font choices when the bundled fonts change.

import { DEFAULT_SETTINGS, type AppSettings } from './defaults';

/// 历史版本默认字体栈 — 存档仍是其中某个值, 说明用户没自定义过字体, 升级到当前默认。
/// 只在精确匹配时替换: 用户改过的字体栈原样保留。
/// 每次改动 DEFAULT_SETTINGS 的字体栈, 都要把被替换掉的旧值追加进来, 否则存量存档会停在
/// 已删除的字体族上 (如 FiraCode / GoMono Nerd Font Mono)。
const LEGACY_DEFAULT_UI_FONTS: readonly string[] = [
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  "'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  "'JetBrains Mono', 'Maple Mono CN', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  "'GoMono Nerd Font Mono', 'Clear Han Serif', 'Maple Mono CN', 'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  "'JetBrainsMono Nerd Font Mono', 'GoMono Nerd Font Mono', 'Clear Han Serif', 'Maple Mono CN', 'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  "'FiraCode Nerd Font Mono', 'GoMono Nerd Font Mono', 'Clear Han Serif', 'Maple Mono CN', 'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  "'FiraCode Nerd Font Mono', 'GoMono Nerd Font Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', sans-serif",
  "'FiraCode Nerd Font Mono', 'GoMono Nerd Font Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'MiSans', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', sans-serif",
];
const LEGACY_DEFAULT_MONO_FONTS: readonly string[] = [
  "'Cascadia Code', 'Fira Code', 'SF Mono', Menlo, monospace",
  "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'SF Mono', Menlo, monospace",
  "'JetBrains Mono', 'Maple Mono CN', 'Cascadia Code', 'Fira Code', 'SF Mono', Menlo, 'PingFang SC', 'Microsoft YaHei', monospace",
  "'GoMono Nerd Font Mono', 'Maple Mono CN', 'Clear Han Serif', 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'SF Mono', Menlo, 'PingFang SC', 'Microsoft YaHei', monospace",
  "'JetBrainsMono Nerd Font Mono', 'GoMono Nerd Font Mono', 'Maple Mono CN', 'Clear Han Serif', 'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'SF Mono', Menlo, 'PingFang SC', 'Microsoft YaHei', monospace",
  "'FiraCode Nerd Font Mono', 'GoMono Nerd Font Mono', 'Maple Mono CN', 'Clear Han Serif', 'JetBrains Mono', 'Cascadia Code', 'SF Mono', Menlo, 'PingFang SC', 'Microsoft YaHei', monospace",
  "'FiraCode Nerd Font Mono', 'GoMono Nerd Font Mono', 'Maple Mono CN', 'JetBrains Mono', 'Cascadia Code', 'SF Mono', Menlo, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', monospace",
];

/// 把"仍是历史默认"的字体栈升级为当前默认; `changed` 表示发生了改写。
/// 已删除的字体族 (Clear Han Serif 等) 留在旧栈里会导致中文落到 Maple Mono (等宽),
/// 因此存量存档必须显式升级一次。
export function migrateLegacyFontDefaults(settings: AppSettings): {
  settings: AppSettings;
  changed: boolean;
} {
  const { appearance } = settings;
  const uiLegacy = LEGACY_DEFAULT_UI_FONTS.includes(appearance.uiFontFamily);
  const monoLegacy = LEGACY_DEFAULT_MONO_FONTS.includes(appearance.monoFontFamily);
  if (!uiLegacy && !monoLegacy) return { settings, changed: false };
  return {
    settings: {
      ...settings,
      appearance: {
        ...appearance,
        uiFontFamily: uiLegacy ? DEFAULT_SETTINGS.appearance.uiFontFamily : appearance.uiFontFamily,
        monoFontFamily: monoLegacy
          ? DEFAULT_SETTINGS.appearance.monoFontFamily
          : appearance.monoFontFamily,
      },
    },
    changed: true,
  };
}
