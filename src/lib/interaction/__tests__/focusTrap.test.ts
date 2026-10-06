import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusableWithin, focusInto, resolveFocusStep, trapTabKey } from '../focusTrap';

/** 搭一个卡片, 内容由传入的 HTML 决定。 */
function surface(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function keydown(key: string, shiftKey = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('focusableWithin', () => {
  it('按文档顺序取出可聚焦元素, 跳过禁用与隐藏输入', () => {
    const root = surface(`
      <a href="#one">a</a>
      <button>b</button>
      <button disabled>c</button>
      <input type="hidden" />
      <input type="text" />
      <select></select>
      <textarea></textarea>
      <div tabindex="-1">d</div>
      <div tabindex="0">e</div>
    `);
    expect(focusableWithin(root).map((el) => el.tagName + (el.textContent ?? ''))).toEqual([
      'Aa',
      'BUTTONb',
      // 无文本的可聚焦控件只剩标签名。
      'INPUT',
      'SELECT',
      'TEXTAREA',
      'DIVe',
    ]);
  });

  it('跳过 inert 子树内的元素', () => {
    const root = surface('<button>a</button><div inert><button>b</button></div>');
    expect(focusableWithin(root)).toHaveLength(1);
  });
});

describe('resolveFocusStep', () => {
  const elements = ['a', 'b', 'c'].map((id) => {
    const el = document.createElement('button');
    el.id = id;
    return el;
  });

  it('空列表返回 null', () => {
    expect(resolveFocusStep([], null, false)).toBeNull();
  });

  it('向前到末尾回绕, 向后到开头回绕', () => {
    expect(resolveFocusStep(elements, elements[2], false)).toBe(elements[0]);
    expect(resolveFocusStep(elements, elements[0], true)).toBe(elements[2]);
  });

  it('焦点不在列表里时按方向落到端点', () => {
    // 焦点可能停在卡片容器本身, 或停在一个已被移除的节点上。
    expect(resolveFocusStep(elements, document.createElement('i'), false)).toBe(elements[0]);
    expect(resolveFocusStep(elements, document.body, true)).toBe(elements[2]);
    expect(resolveFocusStep(elements, null, false)).toBe(elements[0]);
  });

  it('中间元素按方向走一格', () => {
    expect(resolveFocusStep(elements, elements[0], false)).toBe(elements[1]);
    expect(resolveFocusStep(elements, elements[1], true)).toBe(elements[0]);
  });
});

describe('trapTabKey', () => {
  it('非 Tab 键不接管', () => {
    const root = surface('<button>a</button>');
    const event = keydown('Enter');
    expect(trapTabKey(root, event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('已被接管的事件不再处理', () => {
    // 键事件由内向外冒泡; 嵌套浮层时内层先看到它。外层若再算一遍会按外层候选集
    // 把焦点从内层搬走, 用户按一下 Tab 就被弹出当前浮层。
    const root = surface('<button id="outer">a</button>');
    const event = keydown('Tab');
    event.preventDefault();
    expect(trapTabKey(root, event)).toBe(false);
    expect(document.activeElement).not.toBe(root.querySelector('#outer'));
  });

  it('一个可聚焦元素也要接管, 焦点不出卡片', () => {
    const root = surface('<button id="only">a</button>');
    const event = keydown('Tab');
    expect(trapTabKey(root, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('#only'));
  });

  it('没有可聚焦元素时同样接管', () => {
    const root = surface('<span>nothing</span>');
    const event = keydown('Tab');
    expect(trapTabKey(root, event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('末尾向前回绕到首个', () => {
    const root = surface('<button id="a">a</button><button id="b">b</button>');
    const first = root.querySelector<HTMLElement>('#a')!;
    const last = root.querySelector<HTMLElement>('#b')!;
    last.focus();
    trapTabKey(root, keydown('Tab'));
    expect(document.activeElement).toBe(first);
  });

  it('首个向后回绕到末尾', () => {
    const root = surface('<button id="a">a</button><button id="b">b</button>');
    const first = root.querySelector<HTMLElement>('#a')!;
    const last = root.querySelector<HTMLElement>('#b')!;
    first.focus();
    trapTabKey(root, keydown('Tab', true));
    expect(document.activeElement).toBe(last);
  });
});

describe('focusInto', () => {
  it('优先聚焦调用方指定的落点', () => {
    const root = surface('<button id="first">a</button><input id="preferred" />');
    focusInto(root, root.querySelector<HTMLElement>('#preferred'));
    expect(document.activeElement).toBe(root.querySelector('#preferred'));
  });

  it('首选落点不在卡片内时退回第一个可聚焦元素', () => {
    // 调用方可能持有一个属于别处的 ref (如外层弹窗的搜索框)。
    const outside = document.createElement('input');
    document.body.append(outside);
    const root = surface('<button id="first">a</button>');
    focusInto(root, outside);
    expect(document.activeElement).toBe(root.querySelector('#first'));
  });

  it('没有可聚焦元素时聚焦卡片自身并补 tabindex', () => {
    const root = surface('<span>nothing</span>');
    focusInto(root);
    expect(root.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(root);
  });

  it('卡片已有 tabindex 时不覆盖', () => {
    const root = surface('<span>nothing</span>');
    root.setAttribute('tabindex', '0');
    focusInto(root);
    expect(root.getAttribute('tabindex')).toBe('0');
  });

  it('聚焦不滚动页面', () => {
    // 卡片刚插入时浏览器会把它滚进视口, 与进场动画抢同一帧。
    const root = surface('<button id="a">a</button>');
    const target = root.querySelector<HTMLElement>('#a')!;
    const focus = vi.spyOn(target, 'focus');
    focusInto(root);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
