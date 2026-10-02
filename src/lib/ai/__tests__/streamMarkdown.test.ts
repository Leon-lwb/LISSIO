import { describe, expect, it } from 'vitest';
import { splitStreamingMarkdown } from '../streamMarkdown';

/// 流式 Markdown 切分 — 不变式: frozen + active 恒等于原文, 且切点不破坏块级语义。

const paragraph = (label: string, length = 900) => `${label}\n${'句子内容。'.repeat(Math.ceil(length / 5))}`;

describe('splitStreamingMarkdown', () => {
  it('短文本不切分 (没有收益, 保持单块渲染)', () => {
    const text = '短回复。';
    expect(splitStreamingMarkdown(text)).toEqual({ frozen: '', active: text });
  });

  it('长文本在空白行处切分, 拼接后与原文逐字相同', () => {
    const text = `${paragraph('第一段')}\n\n${paragraph('第二段')}`;
    const { frozen, active } = splitStreamingMarkdown(text);
    expect(frozen + active).toBe(text);
    expect(frozen.endsWith('\n\n')).toBe(true);
    expect(active.startsWith('第二段')).toBe(true);
  });

  it('不切进未闭合的围栏代码块', () => {
    const text = `${paragraph('说明')}\n\n\`\`\`rust\n${'let x = 1;\n'.repeat(400)}`;
    const { frozen, active } = splitStreamingMarkdown(text);
    expect(frozen + active).toBe(text);
    // 切点落在围栏之外: frozen 里要么没有围栏开头, 要么围栏已闭合
    const fences = (frozen.match(/```/g) ?? []).length;
    expect(fences % 2).toBe(0);
  });

  it('不把缩进续行开始的新块切出来 (否则会渲染成缩进代码块)', () => {
    const text = `${paragraph('正文')}\n\n${'x'.repeat(2000)}\n    续行内容`;
    const { frozen, active } = splitStreamingMarkdown(text);
    expect(frozen + active).toBe(text);
    expect(active).not.toMatch(/^\s{4}\S/);
  });

  it('不把 setext 下划线切到下一块 (否则标题会变成分隔线)', () => {
    const text = `${paragraph('正文')}\n\n${'标题'.repeat(400)}\n===`;
    const { frozen, active } = splitStreamingMarkdown(text);
    expect(frozen + active).toBe(text);
    expect(active.startsWith('===')).toBe(false);
  });

  it('单段落没有空白行时退到空格处硬切, 尾块有界', () => {
    const text = Array.from({ length: 2000 }, (_, i) => `词${i}`).join(' ');
    const { frozen, active } = splitStreamingMarkdown(text);
    expect(frozen + active).toBe(text);
    expect(active.length).toBeLessThanOrEqual(1200);
    expect(active.startsWith(' ')).toBe(false);
  });

  it('表格行不会被拆到两块 (空白行边界天然不落在表格内)', () => {
    const rows = Array.from({ length: 300 }, (_, i) => `| ${i} | 值 |`).join('\n');
    const text = `说明\n\n| 列 | 值 |\n| --- | --- |\n${rows}`;
    const { frozen, active } = splitStreamingMarkdown(text);
    expect(frozen + active).toBe(text);
    // 表格头与分隔行必须留在同一块
    const headerInFrozen = frozen.includes('| --- | --- |');
    const headerInActive = active.includes('| --- | --- |');
    expect(headerInFrozen || headerInActive).toBe(true);
    if (headerInActive) expect(active).toContain('| 列 | 值 |');
  });
});
