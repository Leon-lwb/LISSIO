import { render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import gsap from 'gsap';
import { useFlipReorder } from '../flipReorder';
import { springAtWithVelocity, springSettleTime } from '../spring';

/**
 * 列表行的让位过程。
 *
 * 面板换边的测试已经钉住"换序"这一种变化; 这里补的是列表更常见的两种 —— 某一行被删掉,
 * 或新插一行 —— 它们对 FLIP 是同一件事: 只有槽位变了。对调用方来说区别很大: 换序是
 * 用户把 A 拖到 B 后面, 删除是 A 消失了而 B 跳了上来, 后者读不出"是谁动了", 所以
 * 必须由 B 自己平滑地让位, 否则那一格看上去是整个列表突然塌了一块。
 *
 * 矩形由测试直接给定 —— jsdom 不做布局, 而 FLIP 的全部意义就是旧槽位与新槽位之间的差。
 * mock 如实还原"getBoundingClientRect 报告带 transform 的盒子"这一点, 否则"测量时把
 * 飞行中的位移减掉"这一步就没东西可减。
 */
let rects = new Map<string, { left: number; top: number }>();

function readTranslate(node: HTMLElement): { x: number; y: number } {
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(node.style.transform ?? '');
  return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 };
}

function row(key: string) {
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
            bottom: top + 20,
            width: 100,
            height: 20,
            x: left,
            y: top,
            toJSON: () => ({}),
          };
        };
      }}
    />
  );
}

/** Vertical stack, 20px per row — the shape every list in the app actually has. */
function Stack({ keys, phase }: { keys: string[]; phase?: 'in' | 'out' }) {
  const ref = useRef<HTMLDivElement>(null);
  // The trigger is the key order and nothing else: it is the only thing that decides
  // which slot a row sits in.
  useFlipReorder(ref, keys.join('|'), { family: 'content', phase });
  return (
    <div ref={ref}>
      {keys.map((key) => (
        <div key={key}>{row(key)}</div>
      ))}
    </div>
  );
}

/** Peak excursion past the target slot, as a fraction of the 1.0 response. */
function peakOvershoot(spring: { stiffness: number; damping: number; mass: number }): number {
  const settle = springSettleTime(spring);
  let peak = 0;
  for (let i = 0; i <= 1000; i += 1) {
    peak = Math.max(peak, springAtWithVelocity(spring, (i / 1000) * settle, 0));
  }
  return peak - 1;
}

const positionsOf = (keys: string[]) =>
  keys.map((key, index) => [key, { left: 0, top: index * 20 }] as const);

const translateOf = (key: string) => {
  const el = document.querySelector<HTMLElement>(`[data-flip-key="${key}"]`)!;
  return el.style.transform ? readTranslate(el) : null;
};

/** The spring the hook actually handed to GSAP for a row. */
function springOf(key: string) {
  const el = document.querySelector<HTMLElement>(`[data-flip-key="${key}"]`)!;
  const tween = gsap.getTweensOf(el)[0];
  return tween?.vars.spring as { stiffness: number; damping: number; mass: number } | undefined;
}

describe('useFlipReorder on a list', () => {
  it('does not animate on the first pass, having nothing to compare against', () => {
    rects = new Map(positionsOf(['a', 'b']));
    render(<Stack keys={['a', 'b']} />);
    expect(translateOf('a')).toBeNull();
    expect(translateOf('b')).toBeNull();
  });

  it('lets the rows below slide up when a row is removed', () => {
    rects = new Map(positionsOf(['a', 'b', 'c']));
    const { rerender } = render(<Stack keys={['a', 'b', 'c']} />);

    // b 被删掉: a 不动, c 从第二格挪到第一格。
    rects = new Map(positionsOf(['a', 'c']));
    rerender(<Stack keys={['a', 'c']} />);

    // 关键断言是 c 此刻**看起来还在原处**(向下被推了 20px 抵消), 而不是已经跳上去。
    expect(translateOf('a')).toBeNull();
    expect(translateOf('c')).toEqual({ x: 0, y: 20 });
  });

  it('lets the rows below slide down when a row is inserted', () => {
    rects = new Map(positionsOf(['a', 'b']));
    const { rerender } = render(<Stack keys={['a', 'b']} />);

    rects = new Map(positionsOf(['a', 'new', 'b']));
    rerender(<Stack keys={['a', 'new', 'b']} />);

    // 插入的是"a 与 b 之间", 所以只推 b。
    expect(translateOf('a')).toBeNull();
    expect(translateOf('new')).toBeNull();
    expect(translateOf('b')).toEqual({ x: 0, y: -20 });
  });

  it('does not sail past the slot it is being sent to', () => {
    // 让位不是"某块被送来", 行的位置是被别人的缺席顶上去的 —— 没有来源也没有动量。
    // 用进场令牌 (允许回弹) 会让它越过槽位再荡回来, 那读起来是渲染故障, 与离场晃动
    // 同一类错误。所以三处块列表都读离场那个临界阻尼的令牌。
    rects = new Map(positionsOf(['a', 'b', 'c']));
    const { rerender } = render(<Stack keys={['a', 'b', 'c']} phase="out" />);
    rects = new Map(positionsOf(['a', 'c']));
    rerender(<Stack keys={['a', 'c']} phase="out" />);

    const spring = springOf('c');
    expect(spring).toBeDefined();
    expect(peakOvershoot(spring!)).toBeLessThanOrEqual(0);
  });

  it('would overshoot on the entrance token, which is why lists do not use it', () => {
    // 反向断言: 默认的进场令牌确实会过冲。没有这一条, "列表传 out" 看起来只是口味选择,
    // 而它实际是在避开一次真实的故障。
    rects = new Map(positionsOf(['a', 'b', 'c']));
    const { rerender } = render(<Stack keys={['a', 'b', 'c']} />);
    rects = new Map(positionsOf(['a', 'c']));
    rerender(<Stack keys={['a', 'c']} />);

    const spring = springOf('c');
    expect(spring).toBeDefined();
    expect(peakOvershoot(spring!)).toBeGreaterThan(0);
  });

  it('ignores the removed row entirely — it has no slot to be sent to', () => {
    rects = new Map(positionsOf(['a', 'b']));
    const { rerender } = render(<Stack keys={['a', 'b']} />);

    // b 消失后 rects 里已经没有它, 组件树里也不该再有它的位移。
    rects = new Map(positionsOf(['a']));
    rerender(<Stack keys={['a']} />);
    expect(document.querySelector('[data-flip-key="b"]')).toBeNull();
    expect(translateOf('a')).toBeNull();
  });
});