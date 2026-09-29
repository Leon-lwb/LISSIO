//! 设置项元数据定义 — 控制类型、字段接口、所有设置项列表
//!
//! 从 SettingsModal.tsx 提取，用于保持文件体积可控

import type { AppSettings } from '../settings/defaults';
import type { ModelDescriptor } from '../types/generated/ModelDescriptor';

export type ControlType =
  | { kind: 'select'; options: { value: string | number; label: string }[] }
  | { kind: 'toggle' }
  | { kind: 'number'; min?: number; max?: number; step?: number }
  | { kind: 'text' }
  | { kind: 'path' }
  | { kind: 'theme' }
  | { kind: 'openSettingsFolder' };

export interface SettingFieldDef {
  category: keyof AppSettings;
  field: string;
  labelKey: string;
  descKey: string;
  control: ControlType;
  /// 用于搜索的关键词 (除了 label/desc)
  keywords?: string[];
}

/// 所有设置项的元数据 — 按分类顺序渲染
/// AI provider 选项 — 目录 aiProvider 家族是唯一权威 (后端 llm::types::ADAPTERS
/// 投影); 不再维护前端硬编码名单。
function aiAdapterField(models: readonly ModelDescriptor[]): SettingFieldDef {
  const options = models
    .filter((model) => model.family === 'aiProvider' && (model.actions ?? []).includes('configure'))
    .map((model) => ({
      value: model.id.startsWith('aiProvider:') ? model.id.slice('aiProvider:'.length) : model.id,
      label: model.display.fallbackLabel,
    }));
  return {
    category: 'ai',
    field: 'adapter',
    labelKey: 'settingAiAdapter',
    descKey: 'settingAiAdapterDesc',
    control: { kind: 'select', options },
    keywords: ['ai', 'llm', 'provider', '模型', '对话'],
  };
}

export function buildSettingFields(models: readonly ModelDescriptor[]): SettingFieldDef[] {
  return SETTING_FIELDS.map((field) => (field.field === 'adapter' ? aiAdapterField(models) : field));
}

const SETTING_FIELDS: SettingFieldDef[] = [
  // General
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
  // Appearance
  {
    category: 'appearance',
    field: 'theme',
    labelKey: 'settingTheme',
    descKey: 'settingThemeDesc',
    control: { kind: 'theme' },
  },
  {
    category: 'appearance',
    field: 'acrylicBackground',
    labelKey: 'settingAcrylicBackground',
    descKey: 'settingAcrylicBackgroundDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'appearance',
    field: 'acrylicOpacity',
    labelKey: 'settingAcrylicOpacity',
    descKey: 'settingAcrylicOpacityDesc',
    control: { kind: 'number', min: 0.1, max: 1, step: 0.05 },
  },
  {
    category: 'appearance',
    field: 'reducedMotion',
    labelKey: 'settingReducedMotion',
    descKey: 'settingReducedMotionDesc',
    control: { kind: 'toggle' },
    keywords: ['animation', 'motion', '动画', '动效'],
  },
  {
    category: 'appearance',
    field: 'uiFontFamily',
    labelKey: 'settingUiFontFamily',
    descKey: 'settingUiFontFamilyDesc',
    control: { kind: 'text' },
  },
  {
    category: 'appearance',
    field: 'uiFontSize',
    labelKey: 'settingUiFontSize',
    descKey: 'settingUiFontSizeDesc',
    control: { kind: 'number', min: 9, max: 24, step: 1 },
  },
  {
    category: 'appearance',
    field: 'monoFontFamily',
    labelKey: 'settingMonoFontFamily',
    descKey: 'settingMonoFontFamilyDesc',
    control: { kind: 'text' },
  },
  {
    category: 'appearance',
    field: 'monoFontSize',
    labelKey: 'settingMonoFontSize',
    descKey: 'settingMonoFontSizeDesc',
    control: { kind: 'number', min: 9, max: 24, step: 1 },
  },
  {
    category: 'appearance',
    field: 'statusBarVisible',
    labelKey: 'settingStatusBarVisible',
    descKey: 'settingStatusBarVisibleDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'appearance',
    field: 'activityBarVisible',
    labelKey: 'settingActivityBarVisible',
    descKey: 'settingActivityBarVisibleDesc',
    control: { kind: 'toggle' },
  },
  // Editor
  {
    category: 'editor',
    field: 'waveformFps',
    labelKey: 'settingWaveformFps',
    descKey: 'settingWaveformFpsDesc',
    control: { kind: 'number', min: 5, max: 120, step: 1 },
  },
  {
    category: 'editor',
    field: 'scopeDefaultTimeBase',
    labelKey: 'settingScopeDefaultTimeBase',
    descKey: 'settingScopeDefaultTimeBaseDesc',
    control: { kind: 'number', min: 0.0001, max: 10, step: 0.0001 },
  },
  {
    category: 'editor',
    field: 'scopeDefaultVPerDiv',
    labelKey: 'settingScopeDefaultVPerDiv',
    descKey: 'settingScopeDefaultVPerDivDesc',
    control: { kind: 'number', min: 0.001, max: 100, step: 0.001 },
  },
  {
    category: 'editor',
    field: 'gridVisible',
    labelKey: 'settingGridVisible',
    descKey: 'settingGridVisibleDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'editor',
    field: 'cursorReadoutVisible',
    labelKey: 'settingCursorReadoutVisible',
    descKey: 'settingCursorReadoutVisibleDesc',
    control: { kind: 'toggle' },
    keywords: ['cursor', 'readout', '光标', '读数'],
  },
  {
    category: 'editor',
    field: 'cursorSnap',
    labelKey: 'settingCursorSnap',
    descKey: 'settingCursorSnapDesc',
    control: { kind: 'toggle' },
    keywords: ['snap', 'cursor', '吸附', '光标'],
  },
  {
    category: 'editor',
    field: 'crosshairVisible',
    labelKey: 'settingCrosshairVisible',
    descKey: 'settingCrosshairVisibleDesc',
    control: { kind: 'toggle' },
    keywords: ['crosshair', '十字线'],
  },
  {
    category: 'editor',
    field: 'hoverPointsVisible',
    labelKey: 'settingHoverPointsVisible',
    descKey: 'settingHoverPointsVisibleDesc',
    control: { kind: 'toggle' },
    keywords: ['hover', 'points', '采样点', 'uplot'],
  },
  {
    category: 'editor',
    field: 'pauseOnInteract',
    labelKey: 'settingPauseOnInteract',
    descKey: 'settingPauseOnInteractDesc',
    control: { kind: 'toggle' },
    keywords: ['pause', 'interact', 'zoom', 'pan', '暂停', '缩放', '拖动'],
  },
  // Data
  {
    category: 'data',
    field: 'waveformBufferPoints',
    labelKey: 'settingWaveformBufferPoints',
    descKey: 'settingWaveformBufferPointsDesc',
    control: { kind: 'number', min: 1000, max: 1_000_000, step: 1000 },
  },
  {
    category: 'data',
    field: 'rawDataBufferBytes',
    labelKey: 'settingRawDataBufferBytes',
    descKey: 'settingRawDataBufferBytesDesc',
    control: { kind: 'number', min: 65536, max: 16_777_216, step: 65536 },
  },
  {
    category: 'data',
    field: 'canBufferFrames',
    labelKey: 'settingCanBufferFrames',
    descKey: 'settingCanBufferFramesDesc',
    control: { kind: 'number', min: 1000, max: 500_000, step: 1000 },
  },
  {
    category: 'data',
    field: 'logicBufferSamples',
    labelKey: 'settingLogicBufferSamples',
    descKey: 'settingLogicBufferSamplesDesc',
    control: { kind: 'number', min: 1000, max: 500_000, step: 1000 },
  },
  // Data — 录制存储与启动行为 (与上面的数据缓存同分类: 统一缓存/保存/浏览)
  {
    category: 'data',
    field: 'recordingDatabaseDir',
    labelKey: 'settingRecDatabaseDir',
    descKey: 'settingRecDatabaseDirDesc',
    control: { kind: 'path' },
    keywords: ['recording', 'database', 'duckdb', 'storage', '录制', '数据库', '保存', '位置'],
  },
  {
    category: 'data',
    field: 'continueEmptySession',
    labelKey: 'settingRecContinueEmpty',
    descKey: 'settingRecContinueEmptyDesc',
    control: { kind: 'toggle' },
    keywords: ['recording', 'session', 'empty', 'resume', '录制', '会话', '续写', '空'],
  },
  {
    category: 'data',
    field: 'cleanupDeleteFailed',
    labelKey: 'settingRecCleanupFailed',
    descKey: 'settingRecCleanupFailedDesc',
    control: { kind: 'toggle' },
    keywords: ['recording', 'cleanup', 'failed', 'crash', '录制', '清理', '失败', '崩溃'],
  },
  {
    category: 'data',
    field: 'cleanupDeleteStopped',
    labelKey: 'settingRecCleanupStopped',
    descKey: 'settingRecCleanupStoppedDesc',
    control: { kind: 'toggle' },
    keywords: ['recording', 'cleanup', 'stopped', '录制', '清理', '已停止'],
  },
  {
    category: 'data',
    field: 'cleanupOlderThanDays',
    labelKey: 'settingRecCleanupOlderDays',
    descKey: 'settingRecCleanupOlderDaysDesc',
    control: { kind: 'number', min: 0, max: 3650, step: 1 },
    keywords: ['recording', 'cleanup', 'expire', 'days', '录制', '清理', '过期', '天数'],
  },
  {
    category: 'data',
    field: 'cleanupKeepLatest',
    labelKey: 'settingRecCleanupKeepLatest',
    descKey: 'settingRecCleanupKeepLatestDesc',
    control: { kind: 'number', min: 0, max: 10_000, step: 1 },
    keywords: ['recording', 'cleanup', 'keep', 'latest', '录制', '清理', '保留', '最近'],
  },
  // Serial
  {
    category: 'serial',
    field: 'defaultBaudRate',
    labelKey: 'settingDefaultBaudRate',
    descKey: 'settingDefaultBaudRateDesc',
    control: {
      kind: 'select',
      options: [
        { value: 9600, label: '9600' },
        { value: 19200, label: '19200' },
        { value: 38400, label: '38400' },
        { value: 57600, label: '57600' },
        { value: 115200, label: '115200' },
        { value: 230400, label: '230400' },
        { value: 460800, label: '460800' },
        { value: 921600, label: '921600' },
      ],
    },
  },
  {
    category: 'serial',
    field: 'defaultDataBits',
    labelKey: 'settingDefaultDataBits',
    descKey: 'settingDefaultDataBitsDesc',
    control: {
      kind: 'select',
      options: [
        { value: 7, label: '7' },
        { value: 8, label: '8' },
      ],
    },
  },
  {
    category: 'serial',
    field: 'defaultParity',
    labelKey: 'settingDefaultParity',
    descKey: 'settingDefaultParityDesc',
    control: {
      kind: 'select',
      options: [
        { value: 'none', label: 'None' },
        { value: 'odd', label: 'Odd' },
        { value: 'even', label: 'Even' },
      ],
    },
  },
  {
    category: 'serial',
    field: 'defaultStopBits',
    labelKey: 'settingDefaultStopBits',
    descKey: 'settingDefaultStopBitsDesc',
    control: {
      kind: 'select',
      options: [
        { value: 'one', label: '1' },
        { value: 'two', label: '2' },
      ],
    },
  },
  {
    category: 'serial',
    field: 'defaultFlowControl',
    labelKey: 'settingDefaultFlowControl',
    descKey: 'settingDefaultFlowControlDesc',
    control: {
      kind: 'select',
      options: [
        { value: 'none', label: 'None' },
        { value: 'software', label: 'Software' },
        { value: 'hardware', label: 'Hardware' },
      ],
    },
  },
  // Notifications
  {
    category: 'notifications',
    field: 'enabled',
    labelKey: 'settingNotifEnabled',
    descKey: 'settingNotifEnabledDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'notifications',
    field: 'duration',
    labelKey: 'settingNotifDuration',
    descKey: 'settingNotifDurationDesc',
    control: { kind: 'number', min: 0, max: 60000, step: 500 },
  },
  {
    category: 'notifications',
    field: 'showOnConnect',
    labelKey: 'settingNotifShowOnConnect',
    descKey: 'settingNotifShowOnConnectDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'notifications',
    field: 'showOnDisconnect',
    labelKey: 'settingNotifShowOnDisconnect',
    descKey: 'settingNotifShowOnDisconnectDesc',
    control: { kind: 'toggle' },
  },
  {
    category: 'notifications',
    field: 'showOnError',
    labelKey: 'settingNotifShowOnError',
    descKey: 'settingNotifShowOnErrorDesc',
    control: { kind: 'toggle' },
  },
  // Performance
  {
    category: 'performance',
    field: 'maxWorkers',
    labelKey: 'settingMaxFeedWorkers',
    descKey: 'settingMaxFeedWorkersDesc',
    control: { kind: 'number', min: 1, max: 64, step: 1 },
    keywords: ['worker', 'parallel', '并行', '解析'],
  },
  {
    category: 'performance',
    field: 'evalWorkers',
    labelKey: 'settingEvalWorkers',
    descKey: 'settingEvalWorkersDesc',
    control: { kind: 'number', min: 1, max: 16, step: 1 },
    keywords: ['worker', 'eval', '评估', '并行', '图计算'],
  },
  {
    category: 'performance',
    field: 'memoryBudgetMb',
    labelKey: 'settingCoalesceMaxBytesKb',
    descKey: 'settingCoalesceMaxBytesKbDesc',
    control: { kind: 'number', min: 32, max: 4096, step: 32 },
    keywords: ['memory', 'buffer', '内存', '缓冲'],
  },
  {
    category: 'performance',
    field: 'previewFpsLimit',
    labelKey: 'settingMaxStreamShards',
    descKey: 'settingMaxStreamShardsDesc',
    control: { kind: 'number', min: 1, max: 120, step: 1 },
    keywords: ['preview', 'fps', '预览', '帧率'],
  },
  {
    category: 'performance',
    field: 'previewBandwidthMbPerSec',
    labelKey: 'settingParseChannelCap',
    descKey: 'settingParseChannelCapDesc',
    control: { kind: 'number', min: 1, max: 1024, step: 1 },
    keywords: ['preview', 'bandwidth', '预览', '带宽'],
  },
  // AI (provider 选项与后端 ai_provider::ADAPTERS 注册表保持一致)
  {
    category: 'ai',
    field: 'adapter',
    labelKey: 'settingAiAdapter',
    descKey: 'settingAiAdapterDesc',
    // 选项由 buildSettingFields 从目录 aiProvider 家族注入
    control: { kind: 'select', options: [] },
    keywords: ['ai', 'llm', 'provider', '模型', '对话'],
  },
  {
    category: 'ai',
    field: 'baseUrl',
    labelKey: 'settingAiBaseUrl',
    descKey: 'settingAiBaseUrlDesc',
    control: { kind: 'text' },
    keywords: ['ai', 'base url', 'endpoint', '端点', '兼容'],
  },
  {
    category: 'ai',
    field: 'apiKey',
    labelKey: 'settingAiApiKey',
    descKey: 'settingAiApiKeyDesc',
    control: { kind: 'text' },
    keywords: ['ai', 'api key', '密钥', 'token'],
  },
  {
    category: 'ai',
    field: 'model',
    labelKey: 'settingAiModel',
    descKey: 'settingAiModelDesc',
    control: { kind: 'text' },
    keywords: ['ai', 'model', '模型'],
  },
  {
    category: 'ai',
    field: 'temperature',
    labelKey: 'settingAiTemperature',
    descKey: 'settingAiTemperatureDesc',
    control: { kind: 'number', min: 0, max: 2, step: 0.1 },
    keywords: ['ai', 'temperature', '温度', '采样'],
  },
  {
    category: 'ai',
    field: 'maxTokens',
    labelKey: 'settingAiMaxTokens',
    descKey: 'settingAiMaxTokensDesc',
    control: { kind: 'number', min: 16, max: 131072, step: 16 },
    keywords: ['ai', 'tokens', '长度'],
  },
  {
    category: 'ai',
    field: 'promptFile',
    labelKey: 'settingAiSystemPrompt',
    descKey: 'settingAiSystemPromptDesc',
    control: { kind: 'openSettingsFolder' },
    keywords: ['ai', 'system prompt', '提示词', 'md', 'markdown', 'folder', '文件夹'],
  },
  {
    category: 'ai',
    field: 'builtinToolsEnabled',
    labelKey: 'settingAiBuiltinTools',
    descKey: 'settingAiBuiltinToolsDesc',
    control: { kind: 'toggle' },
    keywords: ['ai', 'builtin', 'tool', '内置', '工具', '节点', '知识库', 'skill'],
  },
  {
    category: 'ai',
    field: 'mcpToolsEnabled',
    labelKey: 'settingAiMcpTools',
    descKey: 'settingAiMcpToolsDesc',
    control: { kind: 'toggle' },
    keywords: ['ai', 'mcp', '工具', 'tool'],
  },
  {
    category: 'ai',
    field: 'mcpServerPort',
    labelKey: 'settingAiMcpServerPort',
    descKey: 'settingAiMcpServerPortDesc',
    control: { kind: 'number', min: 1024, max: 65535, step: 1 },
    keywords: ['ai', 'mcp', 'server', '端口', 'port'],
  },
];
