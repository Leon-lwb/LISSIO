import type { SettingFieldDef } from '../settingFields';

export const performanceFields: SettingFieldDef[] = [
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
];
