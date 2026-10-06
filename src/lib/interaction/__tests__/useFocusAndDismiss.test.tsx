import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { useFocusTrap } from '../useFocusTrap';
import { useDismissOnEscape } from '../useDismissOnEscape';
import { dismissStackDepth } from '../dismissStack';

/// 把 hook 挂到一段真实 DOM 上: 焦点行为只能对着真元素断言。
function TrapHost({ active, initial }: { active: boolean; initial?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useFocusTrap(root, active, initial ? { initialFocus: search } : undefined);
  return (
    <div ref={root} data-testid="card" tabIndex={-1}>
      <button data-testid="first">一</button>
      {initial && <input ref={search} data-testid="search" />}
      <button data-testid="last">末</button>
    </div>
  );
}

function DismissHost({ active, onDismiss, depth = 0 }: { active: boolean; onDismiss: () => void; depth?: number }) {
  useDismissOnEscape(active, onDismiss, depth);
  return null;
}

function pressEscape() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  mounted.length = 0;
});

/// 退避栈是模块级状态: 用例结束必须显式卸载, 才能确认钩子把栈清干净了。
/// (testing-library 的自动清理发生在本文件的 afterEach 之后, 不能依赖它。)
const mounted: { unmount: () => void }[] = [];

function mount(element: React.ReactElement) {
  const view = render(element);
  mounted.push(view);
  return view;
}

afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((view) => view.unmount());
  });
  expect(dismissStackDepth()).toBe(0);
  vi.restoreAllMocks();
});

describe('useFocusTrap', () => {
  it('激活时把焦点移进卡片', () => {
    const { getByTestId } = mount(<TrapHost active />);
    expect(document.activeElement).toBe(getByTestId('first'));
  });

  it('失活时把焦点还给打开它的元素', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = mount(<TrapHost active />);
    // 打开期间焦点在卡片里
    expect(document.activeElement).not.toBe(trigger);

    rerender(<TrapHost active={false} />);
    expect(document.activeElement).toBe(trigger);
  });

  it('焦点已在卡片内部时不抢 — 调用方自己的落点不该被覆盖', () => {
    const card = document.createElement('div');
    card.tabIndex = -1;
    const inside = document.createElement('button');
    card.appendChild(inside);
    document.body.appendChild(card);
    inside.focus();

    // 把已有焦点的元素直接交给 trap: 它已在卡片内, 不该被挪走
    mount(<TrapHost active={false} />);
    expect(document.activeElement).toBe(inside);
  });

  it('激活后 Tab 被限制在卡片内', () => {
    const { getByTestId } = mount(<TrapHost active />);
    const last = getByTestId('last');
    last.focus();

    act(() => {
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    // 末尾继续向后 → 回绕到首个
    expect(document.activeElement).toBe(getByTestId('first'));
  });

  it('失活后不再接管 Tab — 保留挂载的浮层不该继续劫持键盘', () => {
    const { getByTestId, rerender } = mount(<TrapHost active />);
    rerender(<TrapHost active={false} />);
    const last = getByTestId('last');
    last.focus();

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => {
      last.dispatchEvent(event);
    });
    // 未被接管 → 默认行为仍然有效 (没有 preventDefault)
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it('指定初始落点时优先聚焦它', () => {
    const { getByTestId } = mount(<TrapHost active initial />);
    expect(document.activeElement).toBe(getByTestId('search'));
  });

  it('归还焦点时用 preventScroll, 不让页面跳回顶部', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const focusSpy = vi.spyOn(trigger, 'focus');

    const { rerender } = mount(<TrapHost active />);
    rerender(<TrapHost active={false} />);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('触发元素已被移除时不尝试归还焦点', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender, unmount } = mount(<TrapHost active />);
    trigger.remove();
    // 已断开的元素不该被聚焦 (也没有抛错)
    expect(() => {
      rerender(<TrapHost active={false} />);
      unmount();
    }).not.toThrow();
  });

  it('卸载时归还焦点', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = mount(<TrapHost active />);
    expect(document.activeElement).not.toBe(trigger);
    unmount();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('useDismissOnEscape', () => {
  it('激活时 Escape 触发关闭', () => {
    const onDismiss = vi.fn();
    mount(<DismissHost active onDismiss={onDismiss} />);
    pressEscape();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('失活时 Escape 不触发 — 保留挂载的浮层不该响应键盘', () => {
    const onDismiss = vi.fn();
    mount(<DismissHost active={false} onDismiss={onDismiss} />);
    pressEscape();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('卸载后 Escape 不再触发', () => {
    const onDismiss = vi.fn();
    const { unmount } = mount(<DismissHost active onDismiss={onDismiss} />);
    unmount();
    pressEscape();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('嵌套时只有最内层关闭', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    mount(
      <>
        <DismissHost active onDismiss={outer} depth={0} />
        <DismissHost active onDismiss={inner} depth={1} />
      </>
    );
    pressEscape();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('同一次渲染里树序与深度相反时, 仍按深度选最内层', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    // 内层写在前面、深度更大。React 按树序执行 effect, 所以入栈顺序是"内层先、
    // 外层后"; 若钩子不把 depth 交给栈, 后入栈的外层就会排在最后, Escape 会关错人。
    // (真实场景: 恢复会话时同一帧里既有外层浮层也有它打开的内层浮层。)
    mount(
      <>
        <DismissHost active onDismiss={inner} depth={1} />
        <DismissHost active onDismiss={outer} depth={0} />
      </>
    );
    pressEscape();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('每次渲染都换新回调也不会重排栈次序', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    // 箭头函数体用花括号: 直接 `() => outer()` 会把 vi.fn() 的 any 返回值传出去
    const { rerender } = mount(
      <>
        <DismissHost active onDismiss={() => { outer(); }} depth={0} />
        <DismissHost active onDismiss={() => { inner(); }} depth={1} />
      </>
    );
    // 反复重渲染: 回调每次都是新函数, 但监听器不该重装、次序不该变
    for (let i = 0; i < 3; i += 1) {
      rerender(
        <>
          <DismissHost active onDismiss={() => { outer(); }} depth={0} />
          <DismissHost active onDismiss={() => { inner(); }} depth={1} />
        </>
      );
    }
    pressEscape();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('内层关闭后, 再按 Escape 轮到外层', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const { rerender } = mount(
      <>
        <DismissHost active onDismiss={outer} depth={0} />
        <DismissHost active onDismiss={inner} depth={1} />
      </>
    );
    pressEscape();
    expect(inner).toHaveBeenCalledTimes(1);

    rerender(
      <>
        <DismissHost active onDismiss={outer} depth={0} />
        <DismissHost active={false} onDismiss={inner} depth={1} />
      </>
    );
    pressEscape();
    expect(outer).toHaveBeenCalledTimes(1);
  });
});
