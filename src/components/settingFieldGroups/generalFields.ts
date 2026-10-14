import type { SettingFieldDef } from '../settingFields';

export const generalFields: SettingFieldDef[] = [
{
    category: 'general',
    field: 'language',
    labelKey: 'settingLanguage',
    descKey: 'settingLanguageDesc',
    control: {
      kind: 'select',
      options: [
        { value: 'zh', label: '中文' },
        { value: 'en', label: 'English' },
      ],
    },
  },
  {
    category: 'general',
    field: 'autoConnectOnStart',
    labelKey: 'settingAutoConnectOnStart',
    descKey: 'settingAutoConnectOnStartDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'general',
    field: 'confirmBeforeQuit',
    labelKey: 'settingConfirmBeforeQuit',
    descKey: 'settingConfirmBeforeQuitDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'general',
    field: 'showOnboarding',
    labelKey: 'settingShowOnboarding',
    descKey: 'settingShowOnboardingDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'general',
    field: 'showConfigGuide',
    labelKey: 'settingConfigGuide',
    descKey: 'settingConfigGuideDesc',
    control: { kind: 'toggle' },
    keywords: ['config', 'guide', 'first run', 'language', 'theme', '配置引导', '语言', '主题'],
  },
  {
    category: 'general',
    field: 'showContextualTips',
    labelKey: 'settingShowContextualTips',
    descKey: 'settingShowContextualTipsDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'general',
    field: 'debug',
    labelKey: 'settingDebug',
    descKey: 'settingDebugDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'general',
    field: 'autoCheckUpdate',
    labelKey: 'updateAutoCheck',
    descKey: 'updateAutoCheckDesc',
    control: { kind: 'toggle' },
    keywords: ['update', '更新'],
  },
];
