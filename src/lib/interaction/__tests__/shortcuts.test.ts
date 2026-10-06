import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __clearShortcutsForTests,
  dispatchShortcut,
  matchesAccelerator,
  registerShortcut,
  type KeyLike,
} from '../shortcuts';

const key = (k: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

/// 构造一个真实的 KeyboardEvent 派发对象, target 可控 (用于验证"输入框内让路")。
const event = (k: string, mods: Partial<Omit<KeyLike, 'key'>> = {}, target?: EventTarget) => {
  const e = new KeyboardEvent('keydown', {
    key: k,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    altKey: mods.altKey ?? false,
    cancelable: true,
    bubbles: true,
  });
  if (target) {
    Object.defineProperty(e, 'target', { value: target });
  }
  return e;
};

afterEach(() => {
  __clearShortcutsForTests();
});

describe('matchesAccelerator', () => {
  it('主修饰键: Ctrl 与 Cmd 视为同一个', () => {
    expect(matchesAccelerator(key('z', { ctrlKey: true }), { key: 'z', ctrl: true })).toBe(true);
    expect(matchesAccelerator(key('z', { metaKey: true }), { key: 'z', meta: true })).toBe(true);
    // 声明 ctrl, 但按的是 Cmd: 也算命中 —— 同一份声明要在两个平台都对
    expect(matchesAccelerator(key('z', { metaKey: true }), { key: 'z', ctrl: true })).toBe(true);
  });

  it('没按主修饰键就不命中', () => {
    expect(matchesAccelerator(key('z'), { key: 'z', ctrl: true })).toBe(false);
  });

  it('多按了 Shift 不算命中 — 否则 Ctrl+A 会顺带吃掉 Ctrl+Shift+A', () => {
    expect(matchesAccelerator(key('z', { ctrlKey: true, shiftKey: true }), { key: 'z', ctrl: true })).toBe(false);
    expect(
      matchesAccelerator(key('z', { ctrlKey: true, shiftKey: true }), { key: 'z', ctrl: true, shift: true }),
    ).toBe(true);
  });

  it('多按了 Alt 不算命中', () => {
    expect(matchesAccelerator(key('z', { ctrlKey: true, altKey: true }), { key: 'z', ctrl: true })).toBe(false);
  });

  it('单字符按键大小写不敏感', () => {
    expect(matchesAccelerator(key('Z', { ctrlKey: true }), { key: 'z', ctrl: true })).toBe(true);
  });

  it('标点键按原样比较', () => {
    expect(matchesAccelerator(key(',', { metaKey: true }), { key: ',', meta: true })).toBe(true);
    expect(matchesAccelerator(key('.', { metaKey: true }), { key: ',', meta: true })).toBe(false);
  });
});

describe('dispatchShortcut', () => {
  it('命中时执行并阻止默认行为', () => {
    const run = vi.fn();
    registerShortcut({ id: 'a', key: 'z', ctrl: true, run });
    const e = event('z', { ctrlKey: true });
    expect(dispatchShortcut(e)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('未命中时不执行也不阻止', () => {
    const run = vi.fn();
    registerShortcut({ id: 'a', key: 'z', ctrl: true, run });
    const e = event('q', { ctrlKey: true });
    expect(dispatchShortcut(e)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('run 返回 false 表示"不管", 交回给别的监听者', () => {
    registerShortcut({ id: 'declines', key: 'z', ctrl: true, run: () => false });
    const e = event('z', { ctrlKey: true });
    expect(dispatchShortcut(e)).toBe(false);
    expect(e.defaultPrevented).toBe(false);
  });

  it('焦点在输入框里默认让路', () => {
    const run = vi.fn();
    registerShortcut({ id: 'a', key: 'a', ctrl: true, run });
    const input = document.createElement('input');
    expect(dispatchShortcut(event('a', { ctrlKey: true }, input))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('whileTyping 为真时即使在输入框里也生效', () => {
    const run = vi.fn();
    registerShortcut({ id: 'a', key: 'a', ctrl: true, whileTyping: true, run });
    const input = document.createElement('input');
    expect(dispatchShortcut(event('a', { ctrlKey: true }, input))).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('注销之后不再响应', () => {
    const run = vi.fn();
    const off = registerShortcut({ id: 'a', key: 'z', ctrl: true, run });
    off();
    expect(dispatchShortcut(event('z', { ctrlKey: true }))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('同 id 重复注册: 后来者生效, 且先注册者的清理不会误删新注册的', () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = registerShortcut({ id: 'same', key: 'z', ctrl: true, run: first });
    registerShortcut({ id: 'same', key: 'z', ctrl: true, run: second });
    // 先注册者的清理此刻才跑 —— 它不该把同 id 的新注册删掉
    offFirst();
    dispatchShortcut(event('z', { ctrlKey: true }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('多个加速键各自独立', () => {
    const zed = vi.fn();
    const comma = vi.fn();
    registerShortcut({ id: 'undo', key: 'z', ctrl: true, run: zed });
    registerShortcut({ id: 'settings', key: ',', meta: true, run: comma });
    dispatchShortcut(event('z', { ctrlKey: true }));
    dispatchShortcut(event(',', { metaKey: true }));
    expect(zed).toHaveBeenCalledTimes(1);
    expect(comma).toHaveBeenCalledTimes(1);
  });
});
