import { describe, expect, it, vi } from 'vitest';
import type { DeviceCardModel } from '../../../../lib/acquisition/deviceCardModel';
import {
  PALETTE_CATEGORY_IDS,
  buildPaletteSections,
  categoryLabel,
} from '../paletteSections';

const operations = { byteSource: false, byteSink: false, discover: false, browse: false, read: true, subscribe: true, write: true, method: false };
const endpoint = {
  id: 'primary', displayName: 'Endpoint A', transport: 'future', direction: 'peer',
  status: { state: 'available' }, ports: [],
  configuration: { schemaVersion: 3, jsonSchema: { type: 'object' as const, properties: {} }, uiHints: {} },
};
const card: DeviceCardModel = {
  key: 'future:primary', endpoint,
  adapter: { adapterId: 'future', displayName: 'Future interface', contractVersion: 1, protocol: 'future', transport: 'future', direction: 'peer', operations, dataDomains: ['points'], endpoints: [endpoint] },
};

describe('PALETTE_CATEGORY_IDS', () => {
  it('固定顺序包含全部九个分类', () => {
    expect(PALETTE_CATEGORY_IDS).toEqual([
      'transport', 'protocol', 'send', 'math', 'string', 'display', 'input', 'attributes', 'custom',
    ]);
  });
});

describe('categoryLabel', () => {
  it('中文分类名', () => {
    expect(categoryLabel('zh', 'transport')).toBe('连接设备');
    expect(categoryLabel('zh', 'protocol')).toBe('解析与编码');
    expect(categoryLabel('zh', 'send')).toBe('发送');
    expect(categoryLabel('zh', 'math')).toBe('信号处理');
    expect(categoryLabel('zh', 'string')).toBe('文本处理');
    expect(categoryLabel('zh', 'display')).toBe('显示');
    expect(categoryLabel('zh', 'input')).toBe('交互输入');
    expect(categoryLabel('zh', 'attributes')).toBe('属性');
    expect(categoryLabel('zh', 'custom')).toBe('自定义');
  });

  it('英文分类名', () => {
    expect(categoryLabel('en', 'transport')).toBe('Connections');
    expect(categoryLabel('en', 'input')).toBe('Interactive inputs');
    expect(categoryLabel('en', 'attributes')).toBe('Attributes');
    expect(categoryLabel('en', 'custom')).toBe('Custom');
  });
});

describe('buildPaletteSections', () => {
  const openCustomEditor = vi.fn();
  const sections = buildPaletteSections('zh', { capabilityCards: [card], openCustomEditor });

  it('按固定顺序输出九个分组, header 与 categoryLabel 一致', () => {
    expect(sections.map((s) => s.id)).toEqual([...PALETTE_CATEGORY_IDS]);
    for (const section of sections) {
      expect(section.header).toBe(categoryLabel('zh', section.id));
    }
  });

  it('transport 分组来自后端 capability 设备卡', () => {
    const transport = sections.find((s) => s.id === 'transport');
    expect(transport?.entries).toHaveLength(1);
    expect(transport?.entries[0]).toMatchObject({
      nodeType: 'acquisition',
      label: 'Future interface',
      acquisition: card,
    });
  });

  it('无 capability 时 transport 分组为空数组而非缺失', () => {
    const empty = buildPaletteSections('zh', { capabilityCards: [], openCustomEditor });
    expect(empty.find((s) => s.id === 'transport')?.entries).toEqual([]);
  });

  it('protocol 分组含协议引擎 / FrameDecoder / 点位选择', () => {
    const protocol = sections.find((s) => s.id === 'protocol');
    expect(protocol?.entries.map((e) => e.key)).toEqual(['protocol', 'FrameDecoder', 'point-selector']);
    expect(protocol?.entries[0]?.nodeType).toBe('protocol');
    expect(protocol?.entries[2]?.nodeType).toBe('point-selector');
  });

  it('math 分组含算术 op / 滤波 preset / FFT·IFFT', () => {
    const math = sections.find((s) => s.id === 'math');
    const keys = math?.entries.map((e) => e.key) ?? [];
    expect(keys).toContain('add');
    expect(keys).toContain('sqrt');
    expect(keys).toContain('Lowpass');
    expect(keys).toContain('Bandstop');
    expect(keys).toContain('FFT');
    expect(keys).toContain('IFFT');
    const add = math?.entries.find((e) => e.key === 'add');
    expect(add).toMatchObject({ kind: 'Math', op: 'add' });
    const lowpass = math?.entries.find((e) => e.key === 'Lowpass');
    expect(lowpass).toMatchObject({ kind: 'Filter', preset: 'Lowpass' });
  });

  it('string 分组为 17 种字符串 op 快捷入口', () => {
    const string = sections.find((s) => s.id === 'string');
    expect(string?.entries).toHaveLength(17);
    expect(string?.entries.every((e) => e.kind === 'Str' && e.op)).toBe(true);
  });

  it('attributes 分组含 test-data 属性入口', () => {
    const attributes = sections.find((s) => s.id === 'attributes');
    expect(attributes?.entries.map((e) => e.key)).toEqual(['test-data']);
    expect(attributes?.entries[0]?.attribute).toBe('test-data');
    expect(attributes?.category).toBe('custom');
  });

  it('custom 分组的条目 onAdd 打开自定义编辑器', () => {
    const custom = sections.find((s) => s.id === 'custom');
    expect(custom?.entries).toHaveLength(1);
    custom?.entries[0]?.onAdd?.();
    expect(openCustomEditor).toHaveBeenCalledTimes(1);
  });

  it('display/input/send 分组来自控件注册表', () => {
    const display = sections.find((s) => s.id === 'display');
    expect(display?.entries.map((e) => e.key)).toContain('Waveform');
    const input = sections.find((s) => s.id === 'input');
    expect(input?.entries.map((e) => e.key)).toEqual(['Knob', 'Button', 'Radio', 'Checkbox', 'Slider', 'Trigger', 'TextInput']);
    const send = sections.find((s) => s.id === 'send');
    expect(send?.entries.map((e) => e.key)).toEqual(['Command', 'TextOut']);
  });

  it('条目 label/title 随语言切换', () => {
    const zh = buildPaletteSections('zh', { capabilityCards: [], openCustomEditor });
    const en = buildPaletteSections('en', { capabilityCards: [], openCustomEditor });
    const zhAdd = zh.find((s) => s.id === 'math')?.entries.find((e) => e.key === 'add');
    const enAdd = en.find((s) => s.id === 'math')?.entries.find((e) => e.key === 'add');
    expect(zhAdd?.label).not.toBe(enAdd?.label);
  });
});
