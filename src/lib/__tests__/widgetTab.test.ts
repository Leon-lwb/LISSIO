import { describe, expect, it } from 'vitest';
import { widgetTabType, widgetToTab } from '../utils/widgetTab';
import type { WidgetConfig } from '../../types';

describe('widgetTab 控件 ↔ 窗口映射', () => {
  it('窗口型控件映射到对应 Tab 类型, Tab id 与控件 id 相同', () => {
    const cases: [WidgetConfig['kind'], string][] = [
      ['Waveform', 'waveform-extra'],
      ['PieChart', 'pie'],
      ['Image', 'image'],
      ['Model3D', 'model3d'],
      ['Spectrum', 'spectrum'],
      ['Command', 'command'],
      ['FrameDecoder', 'frame-decoder'],
      ['RawData', 'raw'],
      ['Trigger', 'trigger'],
      // TableView 由后端面板契约 (PanelKind::TableView / tabType "table-view") 声明为
      // 数据面板, 此前前端映射表漏登记导致其数据窗口无法打开 —— 现已由注册表覆盖。
      ['TableView', 'table-view'],
    ];
    for (const [kind, type] of cases) {
      expect(widgetTabType(kind)).toBe(type);
    }
  });

  it('无窗口的控件返回 null', () => {
    expect(widgetTabType('Knob')).toBeNull();
    expect(widgetTabType('Gauge')).toBeNull();
    expect(widgetTabType('Custom')).toBeNull();
    expect(widgetTabType('Math')).toBeNull();
    expect(widgetTabType('Str')).toBeNull();
    expect(widgetTabType('FFT')).toBeNull();
    expect(widgetTabType('TextOut')).toBeNull();
  });

  it('widgetToTab 构造可关闭窗口 Tab, 名称取 params.label (Waveform 固定名)', () => {
    const raw: WidgetConfig = { kind: 'RawData', params: { id: 'raw-1', label: 'Raw Data' } };
    expect(widgetToTab(raw)).toEqual({
      id: 'raw-1',
      type: 'raw',
      name: 'Raw Data',
      widgetId: 'raw-1',
      closable: true,
    });

    const wave: WidgetConfig = {
      kind: 'Waveform',
      params: { id: 'wave-1', label: 'Waveform', channels: 4, max_points: 10000, visible_channels: [true, true, true, true] },
    };
    expect(widgetToTab(wave)?.name).toBe('Waveform');
  });

  it('无窗口控件不产生窗口 Tab', () => {
    // 负数用例 — 映射只看 kind 与 id/label, 其余参数与结论无关
    const knob = { kind: 'Knob', params: { id: 'k-1', label: 'Knob' } } as unknown as WidgetConfig;
    expect(widgetToTab(knob)).toBeNull();
  });
});
