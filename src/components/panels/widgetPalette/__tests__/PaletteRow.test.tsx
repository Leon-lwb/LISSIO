import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { PaletteRow } from '../PaletteRow';
import type { PaletteEntry } from '../paletteModel';

/// 顶到字身框上缘的中文字形 — codeberg #8 里被裁掉上缘的样例
const entry: PaletteEntry = { key: 'str-right-trim', icon: null, label: '右截取', title: '右截取' };

describe('PaletteRow 标签行', () => {
  it('行盒留出字形上缘空间 — truncate 的 overflow:hidden 不得压到 1em', () => {
    const { getByText } = render(
      <PaletteRow entry={entry} category="string" onActivate={() => undefined} />,
    );
    const label = getByText('右截取');

    // 超长文本仍走省略号 (裁剪机制保留)
    expect(label.className).toContain('truncate');
    // leading-none (line-height:1) 小于中文字体的 ascent+descent, 行盒顶部即裁剪线,
    // 「右/插/删」这类上缘齐平的字会被切掉上半 — 必须留出行高余量 (codeberg #8)
    expect(label.className).not.toContain('leading-none');
    expect(label.className).toContain('leading-normal');
  });
});
