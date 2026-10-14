//! 配置引导的开启状态与确认落盘。
//!
//! 页面本身只问两件事 (界面语言、配色主题), 所以状态也极小: 是否打开、本次会话是否已
//! 确认、以及两个值各自的继承来源。继承值在 [`open`] 时**立即生效** —— 整页就是预览,
//! 不需要"预览态/提交态"两套值, 也就不会出现预览与落盘不一致。
//!
//! [`confirm`] 与"跳过"是同一个动作: 所选值已经在 settings store 里, 这里只把
//! `general.lastSeenVersion` 记为当前版本并立即落盘 —— 该字段同时是"引导已完成"的标记
//! (见 `lib/startup/configGuide`)。
//!
//! `completedThisSession` 是启动闸门的会话闩: 测试开关打开时 `needsConfigGuide` 会一直
//! 为真, 没有它引导确认后新手引导与钥匙串提醒就永远排在后面。

import { create } from 'zustand';
import { platform } from '../lib/platform';
import { deriveConfigGuideDefaults } from '../lib/startup/configGuide';
import {
  DEFAULT_CONFIG_GUIDE_SOURCES,
  type ConfigGuideSources,
} from '../settings/configGuideSources';
import { useSettingsStore } from './settingsStore';

/// 引导页可手动更改的字段 (文档存在性不是可选项)。
type ConfigGuideField = 'language' | 'theme';

interface ConfigGuideStore {
  isOpen: boolean;
  /// 本次会话内是否已确认过 —— 启动弹窗闸门据此放行后续弹窗。
  completedThisSession: boolean;
  /// 实际采用的来源层, 仅用于页面上的"配置继承"说明。
  sources: ConfigGuideSources;
  open: () => void;
  /// 用户当场改过某个值 —— 该字段的来源改为"手动选择"。
  markManual: (field: ConfigGuideField) => void;
  confirm: () => Promise<void>;
}

/// 系统外观偏好采集 (薄胶水): 浏览器不支持媒体查询时按"没有系统信息"处理, 于是回落到
/// 主题默认值。
function prefersLightColorScheme(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

export const useConfigGuideStore = create<ConfigGuideStore>((set) => ({
  isOpen: false,
  completedThisSession: false,
  sources: DEFAULT_CONFIG_GUIDE_SOURCES,

  /// 继承值立即生效, 但只在值确实变化时才写: 已持久化的值与默认值路径天然是空操作,
  /// 只有全新安装的"引导默认值/系统外观推导"会真正改值 —— 卡片本身就是预览。
  open: () => {
    const settings = useSettingsStore.getState();
    const derived = deriveConfigGuideDefaults({
      sources: settings.configGuideSources,
      storedLanguage: settings.settings.general.language,
      storedTheme: settings.settings.appearance.theme,
      prefersLight: prefersLightColorScheme(),
    });
    if (derived.language !== settings.settings.general.language) {
      settings.update('general', 'language', derived.language);
    }
    if (derived.theme !== settings.settings.appearance.theme) {
      settings.update('appearance', 'theme', derived.theme);
    }
    set({ isOpen: true, sources: derived.sources });
  },

  markManual: (field) =>
    set((state) => ({ sources: { ...state.sources, [field]: 'manual' } })),

  /// 版本取不到时写 `'unknown'`: 必须是非空值, 否则引导会在每次启动重复出现。
  /// 落盘失败沿用 settings store 的 saveError/重试通知, 内存值保留; 下次启动再弹一次
  /// 是正确的 —— 未落盘即未完成。
  confirm: async () => {
    const version = await platform.getAppVersion().catch(() => 'unknown');
    const settings = useSettingsStore.getState();
    settings.update('general', 'lastSeenVersion', version);
    await settings.save();
    set({ isOpen: false, completedThisSession: true });
  },
}));
