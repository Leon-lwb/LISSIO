import { describe, it, expect } from 'vitest';
import {
  filterSections,
  type PaletteSection,
} from '../paletteModel';

const sections: PaletteSection[] = [
  {
    id: 'input',
    header: 'Input',
    category: 'input',
    entries: [
      { key: 'Knob', icon: null, label: 'Knob', title: 'Knob' },
      { key: 'Button', icon: null, label: 'Button', title: 'Button' },
    ],
  },
  {
    id: 'display',
    header: 'Display',
    category: 'display',
    entries: [{ key: 'Waveform', icon: null, label: 'Waveform', title: 'Waveform' }],
  },
  {
    id: 'math',
    header: 'Math',
    category: 'math',
    entries: [
      { key: 'add', icon: null, label: 'Add', title: 'Add' },
      { key: 'sub', icon: null, label: 'Sub', title: 'Sub' },
    ],
  },
];

describe('filterSections', () => {
  it('分类名称命中整个分类', () => {
    expect(filterSections(sections, 'display')[0]?.entries[0].key).toBe('Waveform');
  });

  it('空查询直接返回原 sections (内容相等)', () => {
    const out = filterSections(sections, '');
    expect(out).toEqual(sections);
  });

  it('全空白查询也视为空', () => {
    const out = filterSections(sections, '   ');
    expect(out).toEqual(sections);
  });

  it('按 label 子串大小写不敏感匹配', () => {
    const out = filterSections(sections, 'kn');
    expect(out).toHaveLength(1);
    expect(out[0]?.entries.map((e) => e.key)).toEqual(['Knob']);
  });

  it('按 title 匹配, 不只匹配 label', () => {
    const sectionsWithTitle: PaletteSection[] = [
      {
        id: 'input',
        header: 'Input',
        category: 'input',
        entries: [
          { key: 'Knob', icon: null, label: 'Knob', title: '旋钮' },
          { key: 'Button', icon: null, label: 'Button', title: '按钮' },
        ],
      },
    ];
    const out = filterSections(sectionsWithTitle, '旋钮');
    expect(out[0]?.entries.map((e) => e.key)).toEqual(['Knob']);
    const out2 = filterSections(sectionsWithTitle, '按钮');
    expect(out2[0]?.entries.map((e) => e.key)).toEqual(['Button']);
  });

  it('全空分组被剔除 (无匹配)', () => {
    const out = filterSections(sections, 'xyz-nothing');
    expect(out).toEqual([]);
  });

  it('保留所有至少有一条命中的分组 (大小写不敏感)', () => {
    const out = filterSections(sections, 'B');
    const allKeys = out.flatMap((s) => s.entries.map((e) => e.key));
    expect(allKeys).toEqual(expect.arrayContaining(['Knob', 'Button', 'sub']));
    expect(allKeys).not.toContain('Waveform');
    expect(allKeys).not.toContain('add');
  });

  it('返回的 sections 不引用原数组 (filter 副作用隔离)', () => {
    const out = filterSections(sections, 'K');
    expect(out).not.toBe(sections);
  });

  it('跨分组命中: "K" 仅命中 Knob (大写敏感测试)', () => {
    const out = filterSections(sections, 'K');
    const allKeys = out.flatMap((s) => s.entries.map((e) => e.key));
    expect(allKeys).toEqual(['Knob']);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('input');
  });

  it('不修改原 sections 的引用 (immutable)', () => {
    const before = sections.map((s) => ({ ...s, entries: [...s.entries] }));
    filterSections(sections, 'kn');
    expect(sections).toEqual(before);
  });

  it('单分组过滤 — 分类页搜索只裁剪当前分类的条目', () => {
    const mathOnly = sections.filter((s) => s.id === 'math');
    const out = filterSections(mathOnly, 'add');
    expect(out).toHaveLength(1);
    expect(out[0]?.entries.map((e) => e.key)).toEqual(['add']);
    expect(filterSections(mathOnly, 'knob')).toEqual([]);
  });
});
