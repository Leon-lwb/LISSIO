import { act, render, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchInput } from '../SearchInput';

import type { ComponentProps } from 'react';

/// 受控包装: 模拟真实调用方的 useState 受控用法, reset 按钮模拟父级外部清空
function ControlledSearchInput(props: Partial<ComponentProps<typeof SearchInput>>) {
  const [value, setValue] = useState(props.value ?? '');
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- 测试专用冒泡探测节点, 无交互语义
    <div
      data-testid="outside"
      onKeyDown={(e) => (e.currentTarget as HTMLElement).dataset.escBubbled = 'true'}
    >
      <button data-testid="reset" onClick={() => setValue('')} />
      <SearchInput {...props} value={value} onChange={setValue} />
    </div>
  );
}

describe('SearchInput', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('渲染 placeholder 与搜索图标', () => {
    const { container } = render(<SearchInput value="" onChange={() => undefined} placeholder="搜索..." />);
    expect(container.querySelector('input')).toHaveAttribute('placeholder', '搜索...');
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('无防抖时每键即时上报', () => {
    const onChange = vi.fn();
    const { container } = render(<SearchInput value="" onChange={onChange} />);
    fireEvent.change(container.querySelector('input')!, { target: { value: 'A3' } });
    expect(onChange).toHaveBeenCalledWith('A3');
  });

  it('debounceMs 期间不上报, 停止输入后才上报一次', () => {
    const onChange = vi.fn();
    const { container } = render(<SearchInput value="" onChange={onChange} debounceMs={150} />);
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.change(input, { target: { value: 'AA' } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('AA');
  });

  it('清除按钮: 有值时出现, 点击立即清空上报 (不走防抖)', () => {
    const onChange = vi.fn();
    const { container } = render(<SearchInput value="AA" onChange={onChange} debounceMs={150} />);
    const clear = container.querySelector('button[aria-label]')!;
    expect(clear).not.toBeNull();
    fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledWith('');
    expect(container.querySelector('input')).toHaveValue('');
  });

  it('ESC 有值时清空并阻止冒泡, 空值时冒泡到外层', () => {
    const onEscape = vi.fn();
    const { container, getByTestId } = render(
      <ControlledSearchInput value="AA" onEscape={onEscape} />
    );
    const input = container.querySelector('input')!;
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(getByTestId('outside').dataset.escBubbled).toBeUndefined();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(2);
    expect(getByTestId('outside').dataset.escBubbled).toBe('true');
  });

  it('外部清空 (父级重置已上报的值) 立即同步回显', () => {
    const { container, getByTestId } = render(<ControlledSearchInput debounceMs={150} />);
    const input = container.querySelector('input')!;
    fireEvent.change(input, { target: { value: 'AA' } });
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(input).toHaveValue('AA');
    fireEvent.click(getByTestId('reset'));
    expect(input).toHaveValue('');
  });

  it('disabled 时输入禁用且不渲染清除按钮', () => {
    const { container } = render(<SearchInput value="AA" onChange={() => undefined} disabled />);
    expect(container.querySelector('input')).toBeDisabled();
    expect(container.querySelector('button')).toBeNull();
  });
});
