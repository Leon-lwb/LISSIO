import { describe, expect, it, vi } from 'vitest';
import { assertCompositedOnly, createBorrowSlot, promote, promotionCount } from '../compositor';

/**
 * 合成器图层预算的第二件事是**transform 的所有权**: 卡片表面为了 hover 抬升带着一条
 * CSS `transition: transform`, 而 JS 补间每帧写一次 `element.style.transform` ——
 * 两个写者同时存在时, 浏览器会在相邻两帧之间再插一次值, 于是 150ms 的弹簧被抹成
 * 300ms 的追赶, 卡片明显落后于自己的透明度。
 */
function withInlineTransition(): HTMLElement {
  const element = document.createElement('div');
  element.style.transitionProperty = 'background-color, transform';
  document.body.append(element);
  return element;
}

describe('promote', () => {
  it('suspends the CSS transform transition while JS owns the property', () => {
    const element = withInlineTransition();
    const release = promote(element);
    expect(element.style.transitionProperty).toBe('none');
    release();
  });

  it('gives the original transition back on release', () => {
    // 归还必须逐字写回: 卡片自己的 transition 清单是它的样式, 借用期间不能被改写。
    const element = withInlineTransition();
    promote(element)();
    expect(element.style.transitionProperty).toBe('background-color, transform');
  });

  it('leaves an element with no inline transition empty afterwards', () => {
    const element = document.createElement('div');
    const release = promote(element);
    release();
    expect(element.style.transitionProperty).toBe('');
  });

  it('only suspends it for animations that actually touch transform', () => {
    const element = withInlineTransition();
    const release = promote(element, ['opacity']);
    expect(element.style.transitionProperty).toBe('background-color, transform');
    release();
  });

  it('keeps the layer and the transition shared across overlapping borrows', () => {
    const element = withInlineTransition();
    const first = promote(element);
    const second = promote(element);
    expect(promotionCount(element)).toBe(2);
    first();
    // 第二次动画还在飞, 不得提前把 transition 还回去 —— 否则它立刻开始与补间抢属性。
    expect(element.style.transitionProperty).toBe('none');
    second();
    expect(element.style.transitionProperty).toBe('background-color, transform');
  });

  it('treats a repeated release as a no-op', () => {
    // 归还是幂等的: 重复调用必须什么都不做, 否则会把 transition 写回借用前的值,
    // 覆盖掉这期间新增的声明。
    const element = withInlineTransition();
    const release = promote(element);
    release();
    element.style.transitionProperty = 'opacity';
    release();
    expect(element.style.transitionProperty).toBe('opacity');
  });

  it('tolerates a missing element', () => {
    expect(() => promote(null)()).not.toThrow();
  });
});

describe('createBorrowSlot', () => {
  it('holds at most one borrow', () => {
    const slot = createBorrowSlot();
    const once = vi.fn();
    slot.take(once);
    slot.release();
    expect(once).toHaveBeenCalledTimes(1);
  });

  it('returns the previous borrow when a new animation takes over', () => {
    // 动画被打断时补间是被 killTweensOf 杀掉的, 它的 onComplete 不会触发 —— 归还
    // 只能由下一段动画来做, 否则那份图层永远留在元素上。
    const slot = createBorrowSlot();
    const killed = vi.fn();
    const next = vi.fn();
    slot.take(killed);
    slot.take(next);
    expect(killed).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    slot.release();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('releases an empty slot without incident', () => {
    const slot = createBorrowSlot();
    slot.release();
    slot.take(vi.fn());
    expect(() => slot.release()).not.toThrow();
  });

  it('never returns the same borrow twice', () => {
    const slot = createBorrowSlot();
    const once = vi.fn();
    slot.take(once);
    slot.release();
    slot.release();
    slot.take(vi.fn());
    expect(once).toHaveBeenCalledTimes(1);
  });
});

describe('assertCompositedOnly', () => {
  it('passes transform and opacity', () => {
    expect(assertCompositedOnly({ x: 10, opacity: 0.5 })).toEqual([]);
  });

  it('reports geometry that would cost a layout per frame', () => {
    expect(assertCompositedOnly({ x: 10, width: 300 })).toEqual(['width']);
  });

  it('excuses geometry on user input', () => {
    // 指针驱动的 resize 每帧一次布局是交互本身的一部分, 不是动效系统的失误。
    expect(assertCompositedOnly({ width: 300 }, { inputDriven: true })).toEqual([]);
  });
});