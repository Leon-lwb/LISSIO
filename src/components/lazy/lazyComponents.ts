//! 懒加载清单 — 全仓唯一声明 `React.lazy` 的地方 (弹窗 + 重型按需面板)。
//!
//! 规范 (由 `eslint.config.js` 的 `no-restricted-syntax` 强制):
//! - 只有本目录 (与面板视图表 `panelViewComponents.tsx`) 可以调用 `lazy(...)`。
//!   散落的 `lazy` 会让「哪些模块是首屏、哪些按需」无法一眼审计。
//! - 各目标模块只需在组件文件末尾补一行 `export default <组件>`; 不再需要
//!   `*.lazy.tsx` 转发壳 — 那层壳只是为绕过 `react-refresh/only-export-components`
//!   的命名约定, 既不产生 chunk 边界, 又多一个要维护的文件。
//! - **打开时才加载**: 调用方用 `{open && <Suspense>…</Suspense>}` 包裹, 避免
//!   启动时多个 lazy chunk 并发加载导致全屏遮罩闪烁 (App 的弹窗宿主即此语义)。
//! - 弹窗用 `SuspenseFallback overlay` (全屏遮罩), dock 内容用默认填充占位。

import { lazy } from 'react';

// ---- 启动/设置类弹窗 (打开才加载) ----
export const LazySettingsModal = lazy(() => import('../SettingsModal'));
export const LazyAboutModal = lazy(() => import('../AboutModal'));
export const LazyOnboardingWizard = lazy(() => import('../onboarding/OnboardingWizard'));
export const LazyHelpCenterModal = lazy(() => import('../onboarding/HelpCenterModal'));
export const LazyUpdateDialog = lazy(() => import('../UpdateDialog'));
export const LazyKeychainPermissionDialog = lazy(() => import('../KeychainPermissionDialog'));
export const LazyCustomWidgetEditorContainer = lazy(
  () => import('../CustomWidgetEditorContainer')
);

// ---- 重型编辑器 (自定义控件编辑器内部的 CodeMirror, 编辑器渲染时才加载) ----
export const LazyCodeEditor = lazy(() => import('../CodeEditor'));

// ---- AI 面板 (默认不可见; 首次显示才拉取 markdown/思考链依赖) ----
export const LazyAiChatPanel = lazy(() => import('../ai/AiChatPanel'));
