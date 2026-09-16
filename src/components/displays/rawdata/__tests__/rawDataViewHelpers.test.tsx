import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  EscapedText,
  escapeControlChar,
  isInvisibleChar,
  segmentEscapedText,
} from '../rawDataViewHelpers';

describe('isInvisibleChar', () => {
  it('C0/DEL/C1 控制字符为不可见', () => {
    expect(isInvisibleChar('\x00')).toBe(true);
    expect(isInvisibleChar('\t')).toBe(true);
    expect(isInvisibleChar('\n')).toBe(true);
    expect(isInvisibleChar('\r')).toBe(true);
    expect(isInvisibleChar('\x1f')).toBe(true);
    expect(isInvisibleChar('\x7f')).toBe(true);
    expect(isInvisibleChar('\u0085')).toBe(true);
  });

  it('可打印字符与常规空白不转义', () => {
    expect(isInvisibleChar('a')).toBe(false);
    expect(isInvisibleChar(' ')).toBe(false);
    expect(isInvisibleChar('中')).toBe(false);
    expect(isInvisibleChar('\u00a0')).toBe(false);
    // 软连字符等零宽符号有意保留 (避免误伤正常文本)
    expect(isInvisibleChar('\u00ad')).toBe(false);
  });
});

describe('escapeControlChar', () => {
  it('常见控制字符映射为可见符号', () => {
    expect(escapeControlChar('\t')).toBe('⇥');
    expect(escapeControlChar('\n')).toBe('↵');
    expect(escapeControlChar('\r')).toBe('␍');
    expect(escapeControlChar('\x00')).toBe('␀');
    expect(escapeControlChar('\x03')).toBe('␃');
    expect(escapeControlChar('\x1f')).toBe('␟');
    expect(escapeControlChar('\x7f')).toBe('␡');
    expect(escapeControlChar('\u0085')).toBe('□');
  });

  it('每个符号占一个字符位', () => {
    for (let code = 0; code < 0x20; code++) {
      expect([...escapeControlChar(String.fromCharCode(code))]).toHaveLength(1);
    }
    expect([...escapeControlChar('\x7f')]).toHaveLength(1);
  });
});

describe('segmentEscapedText', () => {
  it('无不可见字符时单段原样', () => {
    expect(segmentEscapedText('hello')).toEqual([{ text: 'hello', escaped: false }]);
    expect(segmentEscapedText('')).toEqual([]);
  });

  it('按不可见字符交替切分', () => {
    expect(segmentEscapedText('a\nb')).toEqual([
      { text: 'a', escaped: false },
      { text: '↵', escaped: true },
      { text: 'b', escaped: false },
    ]);
    expect(segmentEscapedText('x\r\n\ty')).toEqual([
      { text: 'x', escaped: false },
      { text: '␍↵⇥', escaped: true },
      { text: 'y', escaped: false },
    ]);
    expect(segmentEscapedText('\x01')).toEqual([{ text: '␁', escaped: true }]);
  });
});

describe('EscapedText', () => {
  it('转义符号渲染为弱化 span, 原样文本不加包装', () => {
    const { container } = render(<EscapedText text={'a\nb'} />);
    const spans = container.querySelectorAll('span');
    expect(spans).toHaveLength(3);
    expect(spans[0].textContent).toBe('a');
    expect(spans[1].className).toContain('text-text-secondary');
    expect(spans[1].textContent).toBe('↵');
    expect(spans[2].textContent).toBe('b');
  });

  it('纯文本零开销路径', () => {
    const { container } = render(<EscapedText text="plain" />);
    expect(container.querySelectorAll('span')).toHaveLength(0);
    expect(container.textContent).toBe('plain');
  });
});
