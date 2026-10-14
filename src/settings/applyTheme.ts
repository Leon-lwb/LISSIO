//! 将 appearance 设置应用到 CSS 变量
//!
//! 修改 :root 上的字体变量与颜色 token, 并激活对应主题。
//! 亚克力背景开启时, 在主题应用后把背景类 token 转为半透明 rgba,
//! 并通知原生窗口启用系统毛玻璃效果。

import { transport } from '../lib/rpc';
import { withAlpha } from '../lib/ui/colorAlpha';
import type { AppSettings } from './defaults';
import { applyTheme, getCssVariableName, resolveActiveTheme, getBuiltInCssTheme, type ThemeToken } from './theme';
import { loadCssTheme } from './css-theme-loader';
import { installMotionTokens, setReducedMotionSetting } from '../lib/motion';
import {
  ACRYLIC_BASE_OPACITY,
  acrylicTokenAlpha,
  hostBorrowsSystemMaterial,
  isDarkBackground,
  materialMismatchesTheme,
  parseHexColor,
} from './acrylicMaterial';

/// 亚克力模式下各背景 token 的基准透明度 (未列出的 token 保持不透明)
/// 基准对应 acrylicOpacity = 0.6, 实际透明度 = 基准值 / 0.6 * acrylicOpacity
const ACRYLIC_TOKEN_ALPHA: Partial<Record<ThemeToken, number>> = {
  bgActivity: 0.6,
  bgSidebar: 0.65,
  bgEditor: 0.55,
  bgWindow: 0.5,
  bgPanelHeader: 0.65,
  bgInput: 0.6,
  bgHover: 0.6,
};

export function applyAppearance(appearance: AppSettings['appearance']): void {
  const root = document.documentElement;
  root.style.setProperty('--font-ui', appearance.uiFontFamily);
  root.style.setProperty('--font-mono', appearance.monoFontFamily);
  root.style.setProperty('--font-size-ui', `${appearance.uiFontSize}px`);
  root.style.setProperty('--font-size-mono', `${appearance.monoFontSize}px`);
  // body 元素的 font-size 直接控制 UI 字号
  document.body.style.fontSize = `${appearance.uiFontSize}px`;
  document.body.style.fontFamily = appearance.uiFontFamily;
  // 应用主题颜色
  applyTheme(resolveActiveTheme(appearance));

  // 加载CSS样式主题
  const cssThemeId = appearance.cssTheme;
  const builtInCssTheme = getBuiltInCssTheme(cssThemeId);
  const customCssTheme = appearance.customCssThemes.find((t) => t.id === cssThemeId);
  const cssTheme = builtInCssTheme ?? customCssTheme;
  if (cssTheme) {
    loadCssTheme(cssTheme);
  } else {
    // 默认加载内置default主题
    const defaultTheme = getBuiltInCssTheme('default');
    if (defaultTheme) {
      loadCssTheme(defaultTheme);
    }
  }

  // 亚克力背景: 背景 token 半透明化 + 原生窗口毛玻璃 + Widget 卡片亚克力参数同步
  // 基值一律取主题原始 token (而非 :root 内联现值) — 内联值在 acrylic 开关来回
  // 切换 / 重复 apply 时会残留上一次的 rgba, 再叠加会越改越透
  const activeTheme = resolveActiveTheme(appearance);
  // 浮层底色固定取主题原色, 避免 acrylic 对 bg-* 的半透明处理二次叠加到独立浮层磨砂上。
  root.style.setProperty('--color-float-surface', activeTheme.tokens.bgSidebar);
  root.style.setProperty('--color-dialog-chrome', activeTheme.tokens.bgPanelHeader);
  root.style.setProperty('--color-dialog-chrome-muted', activeTheme.tokens.bgSidebar);
  root.style.setProperty('--color-float-content', activeTheme.tokens.bgEditor);
  const acrylic = appearance.acrylicBackground === true;
  // 原生侧要跟着应用主题走的两件事 (set_window_acrylic):
  //   1. 窗口边框档位 — Windows 的边框默认恒为浅色 (MS: DWMWA_USE_IMMERSIVE_DARK_MODE),
  //      不同步的话深色主题配浅色标题栏。
  //   2. 材料 tint — Win10 的 SWCA 亚克力由应用给色; Win11 的系统背板不接受染色 (Rust 侧忽略)。
  // 材料反档补偿只在"系统材料可能与应用主题相反"的宿主上生效 (见 acrylicMaterial)。
  const themeBackground = activeTheme.tokens.bgWindow;
  const themeDark = isDarkBackground(themeBackground);
  const compensateMaterial = acrylic
    && hostBorrowsSystemMaterial()
    && materialMismatchesTheme(themeBackground);
  if (acrylic) {
    root.dataset.acrylic = 'true';
    const opacity = appearance.acrylicOpacity ?? ACRYLIC_BASE_OPACITY;
    for (const [token, baseAlpha] of Object.entries(ACRYLIC_TOKEN_ALPHA) as [ThemeToken, number][]) {
      const varName = getCssVariableName(token);
      const alpha = acrylicTokenAlpha(baseAlpha, opacity, compensateMaterial);
      root.style.setProperty(varName, withAlpha(activeTheme.tokens[token], alpha));
    }
  } else {
    delete root.dataset.acrylic;
    // 关闭时还原主题原始色, 清掉历史半透明内联值
    for (const token of Object.keys(ACRYLIC_TOKEN_ALPHA) as ThemeToken[]) {
      root.style.setProperty(getCssVariableName(token), activeTheme.tokens[token]);
    }
  }
  // 纯浏览器 dev 环境无 Tauri 后端, 调用失败时静默忽略
  transport.call('set_window_acrylic', {
    enabled: acrylic,
    dark: themeDark,
    tint: parseHexColor(themeBackground) ?? [],
  }).catch(() => { return undefined; });

  // 磨砂参数: Widget 与二级卡片共享基础 blur/saturate token, 透明度和模糊强度按各自设置独立计算。
  // 关键: alpha 必须显著低于 100% 才能看到背后内容 (毛玻璃核心), blur 必须 > 0
  // 才能产生模糊效果. 范围刻意做得激进 — 即使在最实状态 (opacity=1.0) 仍有明显模糊
  // 和半透明, 因为画布内 widget 卡片背后是编辑器画布/网格/曲线, 模糊这些内容是
  // 用户期望的"玻璃"质感的核心, 不能做得太微弱.
  //   - alpha:    0.1→25% (最透), 0.6→45% (基线, 半透明显), 1.0→65% (最实仍半透)
  //   - blur:     0.1→36px (最透, 模糊最强), 0.6→20px (基线), 1.0→10px (最实仍模糊)
  //   - saturate: 0.1→130%, 0.6→180%, 1.0→220%
  const widgetOpacity = Math.min(1, Math.max(0.1, appearance.acrylicOpacity ?? ACRYLIC_BASE_OPACITY));
  const widgetAlphaPct = Math.round(20 + widgetOpacity * 45);      // 0.1→25%, 0.6→47%, 1.0→65%
  const widgetBlurPx = Math.round(8 + (1 - widgetOpacity) * 28);   // 0.1→34px, 0.6→19px, 1.0→8px
  const widgetSaturatePct = Math.round(120 + widgetOpacity * 100); // 0.1→130%, 0.6→180%, 1.0→220%
  root.style.setProperty('--frost-alpha-widget', `${widgetAlphaPct}%`);
  root.style.setProperty('--frost-blur-widget', `${widgetBlurPx}px`);
  root.style.setProperty('--frost-saturate-widget', `${widgetSaturatePct}%`);

  // 二级卡片磨砂与亚克力背景相互独立, 只共享统一的玻璃边缘与色彩增强 token。
  const floatingGlass = appearance.floatingGlass === true;
  root.dataset.floatingGlass = floatingGlass ? 'true' : 'false';
  const floatingOpacity = Math.min(1, Math.max(0.5, appearance.floatingGlassOpacity ?? 0.88));
  root.style.setProperty('--frost-alpha-floating', `${Math.round(floatingOpacity * 100)}%`);

  // 液态玻璃 (折射档) 的 <html> 级标记。
  //
  // 这里只表达"折射功能已请求", 不表达"某个表面此刻是折射档" —— 后者由
  // useGlassSurface() 逐表面判定并写 data-glass-tier。分成两级是因为粒度不同:
  // 全应用一个总开关, 而每个表面的可达档位还取决于角色 (chrome/content/
  // surface 永不到折射档)、后端是否可用、以及帧率守护是否已降级。
  //
  // 写入这一行时不做任何后端探测: 探测要 import 库并建测试画布, 属于启动
  // 热路径上的异步工作, 由 useGlassSurface 的 effect 承担。关闭时删属性,
  // 让 CSS 里任何 [data-liquid-glass] 选择器一并退场。
  if (appearance.liquidGlass === true) {
    root.dataset.liquidGlass = 'true';
  } else {
    delete root.dataset.liquidGlass;
  }

  // 整窗透明度 (CSS 层): body 整体 alpha 同时作用于 backdrop-filter 链路,
  // 与亚克力开关完全独立; 1.0 时不写 style (保持默认不透明)
  const windowOpacity = Math.min(1, Math.max(0.1, appearance.windowOpacity ?? 1));
  if (windowOpacity < 1) {
    root.style.setProperty('--window-opacity', String(windowOpacity));
    document.body.style.opacity = String(windowOpacity);
  } else {
    root.style.removeProperty('--window-opacity');
    document.body.style.opacity = '';
  }

  // 动画速度档位: CSS 过渡和 GSAP 共享同一份节奏
  root.dataset.motionSpeed = appearance.motionSpeed ?? 'standard';
  // 低动画模式: 设置项写入 data 属性, 由 motion 模块与系统偏好合并成唯一权威类
  setReducedMotionSetting(appearance.reducedMotion === true);
  // 速度档位与低动画状态都定下来后再烘焙一次弹簧令牌
  // (CSS linear() 与 GSAP 补间共用同一个求解器, 不会各算各的)
  installMotionTokens();

  // 控件栏/状态栏可见性由 App.tsx 读取 settings 控制, 这里不直接操作
}
