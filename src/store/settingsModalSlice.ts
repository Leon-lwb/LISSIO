//! 设置弹窗的可见性与导航切片 — 与 `settings.json` 文档读写分开。
//!
//! 二级页面 (设置 → AI → 插件 / MCP) 放在 store 而不是组件局部 state, 是为了让
//! 外部入口能直接落到某一页: 端口冲突提示的“打开 MCP 设置”因此直达 MCP 页。

import type { AppSettings } from '../settings/defaults';

/// AI 分类下的二级页面。
export type AiSettingsSection = 'main' | 'plugins' | 'mcp';

/// 弹窗导航状态。
export interface SettingsModalState {
  isOpen: boolean;
  isAboutOpen: boolean;
  activeCategory: keyof AppSettings;
  searchQuery: string;
  /// 设置 → AI 当前所在的二级页面。
  aiSection: AiSettingsSection;
}

/// 弹窗导航动作。
export interface SettingsModalSlice extends SettingsModalState {
  open: (category?: keyof AppSettings) => void;
  /// 直接打开 设置 → AI → MCP (端口冲突提示的落点)。
  openMcpSettings: () => void;
  setAiSection: (section: AiSettingsSection) => void;
  close: () => void;
  openAbout: () => void;
  closeAbout: () => void;
  setActiveCategory: (c: keyof AppSettings) => void;
  setSearchQuery: (q: string) => void;
}

/// 初始导航状态 — 弹窗关闭, 停在常规分类第一级。
export const SETTINGS_MODAL_STATE: SettingsModalState = {
  isOpen: false,
  isAboutOpen: false,
  activeCategory: 'general',
  searchQuery: '',
  aiSection: 'main',
};

/// 构造导航动作。`get` 只用于“未指定分类时保留当前分类”。
export function createSettingsModalSlice(
  set: (partial: Partial<SettingsModalState>) => void,
  get: () => SettingsModalState
): SettingsModalSlice {
  return {
    ...SETTINGS_MODAL_STATE,
    // 常规打开回到第一级; 只有 openMcpSettings 这种显式入口才停在二级页
    open: (category) =>
      set({
        isOpen: true,
        activeCategory: category ?? get().activeCategory,
        searchQuery: '',
        aiSection: 'main',
      }),
    openMcpSettings: () =>
      set({ isOpen: true, activeCategory: 'ai', searchQuery: '', aiSection: 'mcp' }),
    setAiSection: (aiSection) => set({ aiSection }),
    close: () => set({ isOpen: false }),
    openAbout: () => set({ isAboutOpen: true }),
    closeAbout: () => set({ isAboutOpen: false }),
    setActiveCategory: (c) => set({ activeCategory: c }),
    setSearchQuery: (q) => set({ searchQuery: q }),
  };
}
