import { afterEach, describe, expect, it, vi } from 'vitest';
import { dismissStackDepth, pushDismissHandler } from '../dismissStack';

/// 栈是模块级状态, 出栈必须靠返回值。这里统一登记, 漏掉的在 afterEach 里补上。
const pushed: (() => void)[] = [];

function push(onDismiss: () => void, depth = 0): () => void {
  const remove = pushDismissHandler(onDismiss, depth);
  pushed.push(remove);
  return remove;
}

function pressEscape(defaultPrevented = false): void {
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
  if (defaultPrevented) event.preventDefault();
  window.dispatchEvent(event);
}

afterEach(() => {
  pushed.splice(0).forEach((remove) => remove());
  // 出干净了才说明各用例没有互相污染。
  expect(dismissStackDepth()).toBe(0);
  vi.restoreAllMocks();
});

describe('pushDismissHandler', () => {
  it('Escape 交给唯一入栈者, 出栈后不再响应', () => {
    const onDismiss = vi.fn();
    const remove = push(onDismiss);
    expect(dismissStackDepth()).toBe(1);

    pressEscape();
    expect(onDismiss).toHaveBeenCalledTimes(1);

    remove();
    expect(dismissStackDepth()).toBe(0);

    pressEscape();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('嵌套时只关最内层', () => {
    // 设置面板里开着主题编辑器: 按一次 Escape 应该只退一层, 而不是两个都关掉。
    const outer = vi.fn();
    const inner = vi.fn();
    push(outer, 1);
    const removeInner = push(inner, 2);

    pressEscape();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();

    // 内层关掉后, 下一次 Escape 才轮到外层。
    removeInner();
    pressEscape();
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('按深度插入, 不依赖入栈顺序', () => {
    // 同一帧里渲染成"外层已开且内层也开" (恢复会话) 时, React 的 effect 自内向外
    // 执行, 入栈顺序会反过来。深度是结构事实, 不会因为渲染时机而变。
    const inner = vi.fn();
    const outer = vi.fn();
    push(inner, 2);
    push(outer, 1);

    pressEscape();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('最内层不关闭时事件不穿透到背后', () => {
    // "下载中禁止关闭"的浮层不该让 Escape 关掉它背后的东西 —— 那会让用户觉得
    // 按 Escape 反而退得更远。
    const outer = vi.fn();
    push(outer, 1);
    push(vi.fn(), 2);

    pressEscape();
    expect(outer).not.toHaveBeenCalled();
  });

  it('已经 preventDefault 的 Escape 不再触发关闭', () => {
    // 需要一个"更内层已经处理过"的信号。聚焦路径上的搜索框用 Escape 清空自己,
    // 那种情况下不该同时把整个浮层关掉。
    const onDismiss = vi.fn();
    push(onDismiss);

    pressEscape(true);
    expect(onDismiss).not.toHaveBeenCalled();

    // 未被拦下的 Escape 仍然正常关闭, 说明上面的"没触发"不是因为栈坏了。
    pressEscape();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('非 Escape 键不触发', () => {
    const onDismiss = vi.fn();
    push(onDismiss);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('重复出栈无副作用', () => {
    const remove = push(vi.fn());
    remove();
    expect(() => remove()).not.toThrow();
    expect(dismissStackDepth()).toBe(0);
  });

  it('最后一个出栈后卸载 window 监听', () => {
    // 否则整个应用会永远挂着一个每次按键都要过一遍的回调。
    const remove = push(vi.fn());
    const off = vi.spyOn(window, 'removeEventListener');
    remove();
    expect(off).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('仍有浮层时不移除 window 监听', () => {
    push(vi.fn(), 1);
    const remove = push(vi.fn(), 2);
    const off = vi.spyOn(window, 'removeEventListener');
    remove();
    expect(off).not.toHaveBeenCalled();
  });
});
