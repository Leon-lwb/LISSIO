//! 配置引导的纯逻辑 —— 弹出判定与预选值推导。
//!
//! 无 React、无副作用, 因此可以在单测里把「全新安装 / 升级 / 预览开关 / 远程要求 /
//! 系统外观偏好」各种输入直接钉死; 采集 `prefers-color-scheme` 的那一层薄胶水留在
//! store 动作里 (见 `store/configGuideStore`)。

import type { Lang } from '../../i18n';
import type {
  ConfigGuideSources,
  ConfigGuideValueSource,
} from '../../settings/configGuideSources';

/// 用户从未选过语言时引导页的预选值。
///
/// **刻意不是** `DEFAULT_SETTINGS.general.language` (应用默认仍是中文): 第一次面对这张
/// 卡片的用户很可能不读中文, 英文是更安全的起点, 而中文就在旁边一列。
export const CONFIG_GUIDE_DEFAULT_LANGUAGE: Lang = 'en';

/// 设置是否已成功读取 —— 全局只此一份定义 (App 与启动弹窗编排共用)。
///
/// `loaded` 在读取失败时同样为真, 所以判定必须同时要求 `loadError === null`: 失败读取
/// 不得被当成"全新安装", 更不得授权写默认值。
export function settingsReady(state: {
  loaded: boolean;
  loadError: string | null;
}): boolean {
  return state.loaded && state.loadError === null;
}

/// 配置引导是否应当自动出现。
///
/// 自动出现只有一条路径: **读取时根本没有设置文档** (全新安装), 且用户从未确认过。
/// 升级用户带着文档进来, 因此默认不受打扰; 设置里的「配置引导」开关与远程配置是两条
/// 显式覆盖路径 (前者用于预览显示效果)。
///
/// "从未确认过"必须与文档存在性一起看: 确认会写入 `lastSeenVersion`, 它同时是本次
/// 会话内不再重开、以及下次启动不再出现的闩。
export function needsConfigGuide(state: {
  settingsLoaded: boolean;
  sources: ConfigGuideSources;
  lastSeenVersion: string | null;
  /// 设置里的「配置引导」开关 (测试用: 打开即每次启动都显示)。
  showConfigGuide: boolean;
  /// 远程配置入口 —— 目前没有远程来源, 恒为 false; 位置留好, 将来接线不必改动调用方。
  remoteConfigGuide: boolean;
}): boolean {
  if (!state.settingsLoaded) return false;
  if (state.showConfigGuide || state.remoteConfigGuide) return true;
  return state.sources.document === 'absent' && state.lastSeenVersion === null;
}

export interface ConfigGuideDefaults {
  language: Lang;
  theme: string;
  /// 实际采用的来源层 (语言与主题各自判定, 互不牵连; 文档存在性原样带过)。
  sources: ConfigGuideSources;
}

/// 推导引导页的预选值。
///
/// 语言: 已持久化就继承, 从未选过一律用 [`CONFIG_GUIDE_DEFAULT_LANGUAGE`] —— 不按系统
/// 语言推导。主题: 已持久化就继承, 从未选过跟系统外观偏好 (浅色系统给浅色主题), 系统
/// 也说不清时回落深色。
export function deriveConfigGuideDefaults(input: {
  sources: ConfigGuideSources;
  storedLanguage: Lang;
  storedTheme: string;
  prefersLight: boolean;
}): ConfigGuideDefaults {
  const languageStored = input.sources.language === 'stored';
  const languageSource: ConfigGuideValueSource = languageStored ? 'stored' : 'default';
  const themeStored = input.sources.theme === 'stored';
  const themeSource: ConfigGuideValueSource = themeStored
    ? 'stored'
    : input.prefersLight
      ? 'system'
      : 'default';
  return {
    language: languageStored ? input.storedLanguage : CONFIG_GUIDE_DEFAULT_LANGUAGE,
    theme: themeStored ? input.storedTheme : input.prefersLight ? 'light' : 'dark',
    sources: { ...input.sources, language: languageSource, theme: themeSource },
  };
}
