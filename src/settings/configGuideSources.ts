//! 配置引导的继承来源
//!
//! 只依据**当前格式**已持久化的字段判定 (与 `fontDefaults.ts` 同属设置落盘后的规范化
//! 家族), 不读取任何旧版本格式: `settings.json` 里存在 `general.language` /
//! `appearance.theme` 就是"用户选过", 缺失即"从未选过"。
//!
//! `document` 记录读取时**整份设置文档是否存在** —— 它是"全新安装"与"升级"的唯一判据:
//! 引导只在全新安装时自动出现, 升级用户不受打扰。
//!
//! 本模块只回答"这个值从哪来", 不改写任何设置 —— 改写只发生在用户于引导页或设置里
//! 显式选择时。来源分四类: 继承自现有配置 / 按系统偏好推导 / 使用默认值 / 手动选择。

import { SUPPORTED_LANGUAGES, type Lang } from '../i18n';

/// 单个引导值的来源层。
///
/// `stored` / `default` 由持久化文档判定 (见 [`readConfigGuideSources`]), `system` 由
/// `lib/startup/configGuide` 的推导产出; `manual` 不是判定结果 —— 它表示用户在引导页
/// 当场改了这个值, 于是页面上不再声称它是"继承来的"。
export type ConfigGuideValueSource = 'stored' | 'system' | 'default' | 'manual';

/// 读取时设置文档是否存在。
export type ConfigGuideDocument = 'present' | 'absent';

/// 语言、主题各自的来源层, 加上整份文档的存在性。
export interface ConfigGuideSources {
  document: ConfigGuideDocument;
  language: ConfigGuideValueSource;
  theme: ConfigGuideValueSource;
}

/// 没有持久化文档 (全新安装) 时的来源。
export const DEFAULT_CONFIG_GUIDE_SOURCES: ConfigGuideSources = {
  document: 'absent',
  language: 'default',
  theme: 'default',
};

function objectAt(document: unknown, key: string): Record<string, unknown> | null {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null;
  const child = (document as Record<string, unknown>)[key];
  return child && typeof child === 'object' && !Array.isArray(child)
    ? (child as Record<string, unknown>)
    : null;
}

function isSupportedLang(value: unknown): value is Lang {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/// 判定整份文档是否存在, 以及 `general.language` / `appearance.theme` 是否已持久化。
///
/// `document` 是 `app` 子文档 (即 `settings.json` 的 `app` 值), 与
/// `settingsStore.load()` 读到的对象同形; `null` 表示后端那份文件里没有 `app`。
export function readConfigGuideSources(document: unknown): ConfigGuideSources {
  const present = Boolean(document) && typeof document === 'object' && !Array.isArray(document);
  const language = objectAt(document, 'general')?.language;
  const theme = objectAt(document, 'appearance')?.theme;
  return {
    document: present ? 'present' : 'absent',
    language: isSupportedLang(language) ? 'stored' : 'default',
    theme: typeof theme === 'string' && theme.length > 0 ? 'stored' : 'default',
  };
}
