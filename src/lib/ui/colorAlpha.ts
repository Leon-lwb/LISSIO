//! 颜色透明度合成 — 画布 (canvas) / 内联样式 场景的唯一 withAlpha 出口
//!
//! DOM 里带透明度的颜色一律用 CSS token (`--color-*` + `--alpha-*` 或
//! `color-mix()`), 本模块只服务于 CSS 到不了的地方:
//!   - `ctx.fillStyle = …` (uPlot/Canvas2D 吃不了 color-mix 字符串)
//!   - `style.opacity` 等内联数值
//!
//! 用法: 先 `readCssColor('--color-blue')` 取主题当前值, 再 `withAlpha()` 合成。
//! `applyTheme.ts` 的亚克力背景变换复用同一实现, 避免两套 hex 解析。

/// 将 #rgb / #rrggbb 颜色转为带透明度的 rgba; 非 hex 输入原样返回
/// (rgba()/color-mix()/var() 无法在不读 DOM 的情况下合成, 原样返回让调用方决定降级)
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color.trim());
  if (!m) return color;
  let hex = m[1];
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/// 读取 :root 上的 CSS 颜色 token 当前值 (应用主题后的实际值), 读不到返回 fallback
export function readCssColor(name: string, fallback = '#000000'): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/// 读取主题颜色并合成透明度 — 画布绘制带透明度颜色的统一入口
export function cssColorAlpha(name: string, alpha: number, fallback = '#000000'): string {
  return withAlpha(readCssColor(name, fallback), alpha);
}
