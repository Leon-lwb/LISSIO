import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DraftInput, DraftNumberInput, parseDraftNumber } from '../fields';

describe('parseDraftNumber', () => {
  it('空串/非法/越界返回 null', () => {
    expect(parseDraftNumber('')).toBeNull();
    expect(parseDraftNumber('  ')).toBeNull();
    expect(parseDraftNumber('abc')).toBeNull();
    expect(parseDraftNumber('1e309')).toBeNull();
    expect(parseDraftNumber('5', { min: 1, max: 4 })).toBeNull();
    expect(parseDraftNumber('0', { min: 1 })).toBeNull();
    expect(parseDraftNumber('1.5', { integer: true })).toBeNull();
  });

  it('合法值返回数字', () => {
    expect(parseDraftNumber(' 42 ')).toBe(42);
    expect(parseDraftNumber('-3', { min: -5 })).toBe(-3);
    expect(parseDraftNumber('1.5')).toBe(1.5);
    expect(parseDraftNumber('1.5', { integer: false })).toBe(1.5);
  });
});

describe('DraftInput', () => {
  it('输入过程不提交, 失焦才提交', () => {
    const onCommit = vi.fn();
    const { container } = render(<DraftInput value="a" onCommit={onCommit} />);
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ab' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('ab');
  });

  it('回车提交且阻止默认行为', () => {
    const onCommit = vi.fn();
    const { container } = render(<DraftInput value="a" onCommit={onCommit} />);
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'b' } });
    const event = fireEvent.keyDown(input, { key: 'Enter', cancelable: true });
    expect(event).toBe(false);
    expect(onCommit).toHaveBeenCalledWith('b');
  });

  it('值未变化时失焦不提交', () => {
    const onCommit = vi.fn();
    const { container } = render(<DraftInput value="a" onCommit={onCommit} />);
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('validate 失败标红保留草稿且不提交', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <DraftInput value="" onCommit={onCommit} validate={(draft) => /^\d*$/.test(draft)} />
    );
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.className).toContain('border-red');
    expect(input.value).toBe('abc');
  });

  it('未聚焦时外部值变化同步草稿', () => {
    const onCommit = vi.fn();
    const { container, rerender } = render(<DraftInput value="a" onCommit={onCommit} />);
    const input = container.querySelector('input')!;
    expect(input.value).toBe('a');
    rerender(<DraftInput value="b" onCommit={onCommit} />);
    expect(input.value).toBe('b');
  });

  it('聚焦中忽略外部值同步, 不打断输入', () => {
    const onCommit = vi.fn();
    const { container, rerender } = render(<DraftInput value="a" onCommit={onCommit} />);
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'draft' } });
    rerender(<DraftInput value="b" onCommit={onCommit} />);
    expect(input.value).toBe('draft');
  });
});

describe('DraftNumberInput', () => {
  it('输入中间态不解析, 失焦提交合法值', () => {
    const onCommit = vi.fn();
    const { container } = render(<DraftNumberInput value={7} min={1} integer onCommit={onCommit} />);
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.change(input, { target: { value: '15' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(15);
  });

  it('非法值红框提示且不写入 (number 输入原生丢弃非数字文本)', () => {
    const onCommit = vi.fn();
    const { container } = render(<DraftNumberInput value={7} onCommit={onCommit} />);
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.className).toContain('border-red');
  });

  it('越界值标红不写入', () => {
    const onCommit = vi.fn();
    const { container } = render(<DraftNumberInput value={7} min={1} max={10} onCommit={onCommit} />);
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('提交相同数值不触发 onCommit', () => {
    const onCommit = vi.fn();
    const { container } = render(<DraftNumberInput value={7} onCommit={onCommit} />);
    const input = container.querySelector('input')!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });
});
