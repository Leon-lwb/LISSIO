import { describe, expect, it, vi } from 'vitest';
import type { DeviceCardModel } from '../../../../lib/acquisition/deviceCardModel';
import { seedModelCatalogForTests } from '../../../../test/modelCatalog';
import { resetModelCatalogForTests, useModelCatalogStore } from '../../../../store/modelCatalogStore';
import { afterAll } from 'vitest';
import {
  PALETTE_CATEGORY_IDS,
  buildPaletteSections,
  categoryLabel,
} from '../paletteSections';

const operations = { byteSource: false, byteSink: false, discover: false, browse: false, read: true, subscribe: true, write: true, method: false };
const endpoint = {
  id: 'primary', displayName: 'Endpoint A', transport: 'future', direction: 'peer',
  status: { state: 'available', detail: null }, ports: [],
  configuration: { schemaVersion: 3, jsonSchema: { type: 'object' as const, properties: {} }, uiHints: null },
  display: null,
};
const card: DeviceCardModel = {
  key: 'future:primary', endpoint,
  adapter: { adapterId: 'future', displayName: 'Future interface', contractVersion: 1, protocol: 'future', transport: 'future', direction: 'peer', operations, dataDomains: ['points'], endpoints: [endpoint], display: null },
};

const openCustomEditor = vi.fn();

/// 目录驱动的 math/str/filter 变体条目 — models 参数来自模型目录 store
function sectionsWith(models?: Parameters<typeof buildPaletteSections>[1]['models'], editor: () => void = openCustomEditor) {
  return buildPaletteSections('zh', { capabilityCards: [card], openCustomEditor: editor, models: models ?? useModelCatalogStore.getState().models });
}

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
  seedModelCatalogForTests();

  const sections = sectionsWith();

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
    const empty = buildPaletteSections('zh', { capabilityCards: [], openCustomEditor, models: [] });
    expect(empty.find((s) => s.id === 'transport')?.entries).toEqual([]);
  });

  it('protocol 分组含协议引擎 / FrameDecoder / 点位选择', () => {
    const protocol = sections.find((s) => s.id === 'protocol');
    expect(protocol?.entries.map((e) => e.key)).toEqual(['protocol', 'FrameDecoder', 'point-selector']);
    expect(protocol?.entries[0]?.nodeType).toBe('protocol');
    expect(protocol?.entries[2]?.nodeType).toBe('point-selector');
  });

  it('math 分组条目来自目录变体 (modelId + variantId), 含 FFT·IFFT', () => {
    const math = sections.find((s) => s.id === 'math');
    const keys = math?.entries.map((e) => e.key) ?? [];
    expect(keys).toContain('widget:Math:add');
    expect(keys).toContain('widget:Math:sqrt');
    expect(keys).toContain('widget:Filter:Lowpass');
    expect(keys).toContain('widget:Filter:Bandstop');
    expect(keys).toContain('FFT');
    expect(keys).toContain('IFFT');
    const add = math?.entries.find((e) => e.variantId === 'add');
    expect(add).toMatchObject({ kind: 'Math', modelId: 'widget:Math', variantId: 'add' });
    const lowpass = math?.entries.find((e) => e.variantId === 'Lowpass');
    expect(lowpass).toMatchObject({ kind: 'Filter', modelId: 'widget:Filter', variantId: 'Lowpass' });
  });

  it('string 分组条目来自目录 Str 变体', () => {
    const string = sections.find((s) => s.id === 'string');
    expect(string?.entries).toHaveLength(2); // fixture: len/concat
    expect(string?.entries.every((e) => e.kind === 'Str' && e.modelId === 'widget:Str' && e.variantId)).toBe(true);
  });

  it('目录缺失的变体映射用 fallbackLabel 展示 (新变体免改面板)', () => {
    const raw = useModelCatalogStore.getState().models;
    const mathModel = raw.find((m) => m.id === 'widget:Math');
    const patched = [
      ...raw.filter((m) => m.id !== 'widget:Math'),
      {
        ...mathModel!,
        variants: [
          { id: 'future_op', display: { fallbackLabel: 'Math future_op', category: 'variants', sortValue: 99 }, configPatch: { op: 'future_op' } },
        ],
      },
    ];
    const sections = sectionsWith(patched);
    const entry = sections.find((s) => s.id === 'math')?.entries.find((e) => e.variantId === 'future_op');
    expect(entry?.label).toBe('Math future_op');
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
    const zh = buildPaletteSections('zh', { capabilityCards: [], openCustomEditor, models: useModelCatalogStore.getState().models });
    const en = buildPaletteSections('en', { capabilityCards: [], openCustomEditor, models: useModelCatalogStore.getState().models });
    const zhAdd = zh.find((s) => s.id === 'input')?.entries.find((e) => e.key === 'Knob');
    const enAdd = en.find((s) => s.id === 'input')?.entries.find((e) => e.key === 'Knob');
    expect(zhAdd?.label).not.toBe(enAdd?.label);
  });

  afterAll(() => resetModelCatalogForTests());
});
