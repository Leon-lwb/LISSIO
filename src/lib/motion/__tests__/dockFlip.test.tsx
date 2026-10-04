import { render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { useDockReorder } from '../dockFlip';

/**
 * 面板矩形由测试直接给定 —— jsdom 不做布局, 而 FLIP 的全部意义就是"旧槽位与新槽位
 * 之间的差", 所以让几何成为被注入的输入比伪造 getBoundingClientRect 更诚实。
 *
 * 关键的细节: 浏览器里的 getBoundingClientRect 报告的是**带 transform 的**盒子。
 * 这个 mock 如实还原这一点, 否则"测量时把飞行中的位移减掉"这一步就没东西可减,
 * 相应地也测不出它是否真的做了。
 */
let rects = new Map<string, { left: number; top: number }>();

function readTranslate(node: HTMLElement): { x: number; y: number } {
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(node.style.transform ?? '');
  return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 };
}

function slot(key: string) {
  return (
    <div
      data-testid={key}
      data-flip-key={key}
      ref={(node) => {
        if (!node) return;
        node.getBoundingClientRect = () => {
          const base = rects.get(key) ?? { left: 0, top: 0 };
          const shift = readTranslate(node);
          const left = base.left + shift.x;
          const top = base.top + shift.y;
          return {
            left,
            top,
            right: left + 100,
            bottom: top + 100,
            width: 100,
            height: 100,
            x: left,
            y: top,
            toJSON: () => ({}),
          };
        };
      }}
    />
  );
}

function Harness({ order }: { order: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useDockReorder(ref, order);
  return (
    <div ref={ref}>
      {order === 'swapped' ? (
        <>
          {slot('b')}
          {slot('a')}
        </>
      ) : (
        <>
          {slot('a')}
          {slot('b')}
        </>
      )}
    </div>
  );
}

const translateOf = (key: string) => {
  const el = document.querySelector<HTMLElement>(`[data-flip-key="${key}"]`)!;
  const value = readTranslate(el);
  return el.style.transform ? value : null;
};

const INITIAL: [string, { left: number; top: number }][] = [
  ['a', { left: 0, top: 0 }],
  ['b', { left: 100, top: 0 }],
];

const SWAPPED: [string, { left: number; top: number }][] = [
  ['a', { left: 100, top: 0 }],
  ['b', { left: 0, top: 0 }],
];

describe('useDockReorder', () => {
  it('does not animate on the first pass, having nothing to compare against', () => {
    rects = new Map(INITIAL);
    render(<Harness order="a:b" />);
    // 首帧没有旧槽位; 无从谈"从哪来"。
    expect(translateOf('a')).toBeNull();
    expect(translateOf('b')).toBeNull();
  });

  it('offsets a panel back to its old slot when the group reorders', () => {
    rects = new Map(INITIAL);
    const { rerender } = render(<Harness order="a:b" />);
    rects = new Map(SWAPPED);
    rerender(<Harness order="swapped" />);
    // 关键断言是"看起来还在旧位置", 而不是"已经到了新位置"。
    expect(translateOf('a')).toEqual({ x: -100, y: 0 });
    expect(translateOf('b')).toEqual({ x: 100, y: 0 });
  });

  it('moves vertically as well when the group changes rows', () => {
    rects = new Map(INITIAL);
    const { rerender } = render(<Harness order="a:b" />);
    rects = new Map([
      ['a', { left: 0, top: 200 }],
      ['b', { left: 100, top: 0 }],
    ]);
    rerender(<Harness order="moved" />);
    expect(translateOf('a')).toEqual({ x: 0, y: -200 });
    // 没动的面板不该被平移。
    expect(translateOf('b')).toBeNull();
  });

  it('ignores sub-pixel layout noise', () => {
    rects = new Map(INITIAL);
    const { rerender } = render(<Harness order="a:b" />);
    rects = new Map([
      ['a', { left: 0.2, top: 0 }],
      ['b', { left: 100, top: 0 }],
    ]);
    rerender(<Harness order="nudged" />);
    // 亚像素抖动不是位移, 对它起补间只会让面板无缘无故抖一下。
    expect(translateOf('a')).toBeNull();
  });

  it('does not animate when the ordering is unchanged', () => {
    rects = new Map(INITIAL);
    const { rerender } = render(<Harness order="a:b" />);
    rects = new Map([
      ['a', { left: 400, top: 0 }],
      ['b', { left: 100, top: 0 }],
    ]);
    rerender(<Harness order="a:b" />);
    // 窗口缩放会挪动矩形, 但那不是"换边"; 不该被当成一次迁移播放。
    expect(translateOf('a')).toBeNull();
  });

  it('measures the settled slot, not the animating box, on a second reorder', () => {
    rects = new Map(INITIAL);
    const { rerender } = render(<Harness order="a:b" />);
    rects = new Map(SWAPPED);
    rerender(<Harness order="swapped" />);
    // a 此刻正带着 -100 的位移飞行中, 它的盒子落在 -100 而不是槽位 100。
    expect(translateOf('a')).toEqual({ x: -100, y: 0 });

    rects = new Map([
      ['a', { left: 50, top: 0 }],
      ['b', { left: 0, top: 0 }],
    ]);
    rerender(<Harness order="settled-elsewhere" />);
    // a 的落定槽位从 100 移到 50 (向左 50px), 所以补间起点是 +50, 让它在换槽那一刻
    // 视觉上不动。若把飞行中的盒子(-100)当成旧槽位, 起点会变成 -100 —— 面板会先
    // 反向弹一下再回来, 这正是这个减法要防的故障。
    expect(translateOf('a')).toEqual({ x: 50, y: 0 });
  });

  it('re-reads slots after a window resize, so a later swap starts from the real position', () => {
    rects = new Map(INITIAL);
    const { rerender } = render(<Harness order="a:b" />);
    // 缩放窗口会挪动所有面板, 但不会重渲染这棵树。
    rects = new Map([
      ['a', { left: 0, top: 0 }],
      ['b', { left: 300, top: 0 }],
    ]);
    window.dispatchEvent(new Event('resize'));
    rects = new Map([
      ['a', { left: 200, top: 0 }],
      ['b', { left: 0, top: 0 }],
    ]);
    rerender(<Harness order="swapped" />);
    // 记住的矩形若还是缩放前的, a 的起点会带上那 200px 窗口偏移, 面板会先弹一下再回来。
    expect(translateOf('a')).toEqual({ x: -200, y: 0 });
    expect(translateOf('b')).toEqual({ x: 300, y: 0 });
  });

  it('leaves no transform behind once the panel settles', async () => {
    rects = new Map(INITIAL);
    const { rerender } = render(<Harness order="a:b" />);
    rects = new Map(SWAPPED);
    rerender(<Harness order="swapped" />);
    const el = document.querySelector<HTMLElement>('[data-flip-key="a"]')!;
    expect(el.style.transform).not.toBe('');

    await waitFor(() => {
      // 落定后把 transform 与 z-index 交还给 CSS, 否则内联样式会一直钉住这个元素。
      expect(el.style.transform).toBe('');
      expect(el.style.zIndex).toBe('');
    });
  });
});
