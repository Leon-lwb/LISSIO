//! 控件测试夹具 — 静态测试数据 (渲染/交互测试的输入), 不是生产默认值工厂。
//! 业务默认值/归一化的单一权威在后端 kind::widgets 注册表 + prepare。

import { nanoid } from 'nanoid';
import type { WidgetConfig } from '../types';

const PARAMS: Record<string, Record<string, unknown>> = {
  Waveform: { channels: 4, max_points: 10000, visible_channels: [true, true, true, true] },
  Knob: { min: 0, max: 100, step: 1, value: 50, binding: { mode: 'None' } },
  Slider: { min: 0, max: 100, step: 1, value: 50, binding: { mode: 'None' } },
  Radio: {
    options: [
      { id: 'opt-a', label: 'A', value: 0 },
      { id: 'opt-b', label: 'B', value: 1 },
    ],
    selectedId: 'opt-a',
    binding: { mode: 'None' },
  },
  Checkbox: {
    options: [
      { id: 'opt-a', label: 'A', value: 1 },
      { id: 'opt-b', label: 'B', value: 2 },
    ],
    selectedIds: [],
    binding: { mode: 'None' },
  },
  NumberDisplay: { unit: '', precision: 2, channel: null },
  Gauge: {
    range: { mode: 'manual', min: 0, max: 100, windowSec: 10, majorTicks: 5, precision: 'auto' },
    unit: '', channel: null,
  },
  Progress: {
    range: { mode: 'manual', min: 0, max: 100, windowSec: 10, majorTicks: 5, precision: 'auto' },
    unit: '', orientation: 'horizontal', showValue: true, color: '', channel: null,
  },
  Str: { op: 'len', pos: 1, len: 0, size: 0, tmpl: '' },
  TextInput: { text: '', placeholder: '' },
};

/** 构造一个静态夹具控件; patch 覆盖 params 字段。 */
export function widgetFixture(
  kind: keyof typeof PARAMS | (string & {}),
  patch: Record<string, unknown> = {},
): WidgetConfig {
  const base = PARAMS[kind] ?? {};
  const id = nanoid(8);
  return {
    kind,
    params: { id, label: kind, ...structuredClone(base), ...patch },
  } as WidgetConfig;
}
