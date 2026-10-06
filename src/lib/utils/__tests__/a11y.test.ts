import { describe, expect, it } from 'vitest';
import { activateOnKeyboard, isTextEntryTarget } from '../a11y';

const el = (tag: string): HTMLElement => document.createElement(tag);

/// 构造一个"标签之外"的事件目标: 用 div 再挂上 contentEditable。
const editable = (): HTMLElement => {
  const div = document.createElement('div');
  // jsdom 的 contentEditable 是普通属性, 不会自动派生 isContentEditable
  Object.defineProperty(div, 'isContentEditable', { value: true });
  return div;
};

describe('isTextEntryTarget', () => {
  it('input / textarea / select 都算文本输入控件', () => {
    expect(isTextEntryTarget(el('input'))).toBe(true);
    expect(isTextEntryTarget(el('textarea'))).toBe(true);
    expect(isTextEntryTarget(el('select'))).toBe(true);
  });

  it('select 必须算在内 — 它自己消费 Ctrl+A 与方向键', () => {
    // 这条是这次收敛要修的缺陷: 有两处调用点漏了 select, 于是列表上的 Ctrl+A
    // 会把"全选下拉项"抢成"全选整个列表"。
    expect(isTextEntryTarget(el('select'))).toBe(true);
  });

  it('标签大小写不影响判断', () => {
    // 浏览器给到的是大写标签名, 但 HTML 里小写也合法, 两种都得认。
    const upper = document.createElement('div');
    Object.defineProperty(upper, 'tagName', { value: 'INPUT' });
    expect(isTextEntryTarget(upper)).toBe(true);
  });

  it('contentEditable 元素算在内, 即使它是个 div', () => {
    expect(isTextEntryTarget(editable())).toBe(true);
  });

  it('普通元素与文档节点不算', () => {
    expect(isTextEntryTarget(el('div'))).toBe(false);
    expect(isTextEntryTarget(el('button'))).toBe(false);
    expect(isTextEntryTarget(document)).toBe(false);
  });

  it('target 为 null 或非元素时不炸', () => {
    // window 上挂的 keydown 监听拿到的 target 可能是任意 EventTarget。
    expect(isTextEntryTarget(null)).toBe(false);
    expect(isTextEntryTarget(window)).toBe(false);
  });
});

describe('activateOnKeyboard', () => {
  it('Enter 与空格触发点击并阻止默认行为', () => {
    for (const key of ['Enter', ' ']) {
      const button = el('button');
      let clicks = 0;
      button.addEventListener('click', () => {
        clicks += 1;
      });
      let prevented = false;
      activateOnKeyboard({
        key,
        currentTarget: button,
        preventDefault: () => {
          prevented = true;
        },
      } as unknown as Parameters<typeof activateOnKeyboard>[0]);
      expect(clicks, `${key} 应触发点击`).toBe(1);
      expect(prevented, `${key} 应阻止默认行为 — 否则空格会滚页面`).toBe(true);
    }
  });

  it('其它按键既不点击也不阻止默认行为', () => {
    const button = el('button');
    let clicks = 0;
    button.addEventListener('click', () => {
      clicks += 1;
    });
    let prevented = false;
    activateOnKeyboard({
      key: 'a',
      currentTarget: button,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as Parameters<typeof activateOnKeyboard>[0]);
    expect(clicks).toBe(0);
    expect(prevented).toBe(false);
  });
});
