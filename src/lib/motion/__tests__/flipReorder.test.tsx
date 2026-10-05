import { render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import gsap from 'gsap';
import { useFlipReorder } from '../flipReorder';
import { promotionCount } from '../compositor';
import { reflowSpring } from '../motionConfig';
import { springSettleTime } from '../spring';

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
function Stack({ keys, reflow = true }: { keys: string[]; reflow?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // The trigger is the key order and nothing else: it is the only thing that decides
  // which slot a row sits in. `reflow: false` is the counterfactual — what a plain
  // family/phase lookup would have given.
  useFlipReorder(ref, keys.join('|'), reflow ? { spring: reflowSpring } : { family: 'content' });
  return (
    <div ref={ref}>
      {keys.map((key) => (
        <div key={key}>{row(key)}</div>
      ))}
    </div>
  );
}

/**
 * Peak excursion past the target, as a fraction of the 1.0 response.
 *
 * 采样的是**补间真正使用的那条曲线** (`vars.ease`), 而不是它背后的弹簧对象: 曲线
 * 是否过冲才是观感的事实, 而中间变量随时可能被换一种接法 —— 之前这里断言的是
 * `vars.spring`, 于是弹簧根本没接上补间时它照样通过。
 */
function peakOvershoot(curve: (ratio: number) => number): number {
  let peak = 0;
  for (let i = 0; i <= 1000; i += 1) {
    peak = Math.max(peak, curve(i / 1000));
  }
  return peak - 1;
}

const positionsOf = (keys: string[]) =>
  keys.map((key, index) => [key, { left: 0, top: index * 20 }] as const);

const translateOf = (key: string) => {
  const el = document.querySelector<HTMLElement>(`[data-flip-key="${key}"]`)!;
  return el.style.transform ? readTranslate(el) : null;
};

/** The curve and clock the hook actually handed to GSAP for a row. */
function curveOf(key: string) {
  const el = document.querySelector<HTMLElement>(`[data-flip-key="${key}"]`)!;
  const tween = gsap.getTweensOf(el)[0];
  return tween?.vars.ease as ((ratio: number) => number) | undefined;
}

function tweenOf(key: string) {
  const el = document.querySelector<HTMLElement>(`[data-flip-key="${key}"]`)!;
  return gsap.getTweensOf(el)[0];
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
    // 同一类错误。所以三处块列表都读让位那份临界阻尼的时序。
    rects = new Map(positionsOf(['a', 'b', 'c']));
    const { rerender } = render(<Stack keys={['a', 'b', 'c']} />);
    rects = new Map(positionsOf(['a', 'c']));
    rerender(<Stack keys={['a', 'c']} />);

    const curve = curveOf('c');
    expect(curve).toBeDefined();
    expect(peakOvershoot(curve!)).toBeLessThanOrEqual(0);
  });

  it('runs on the spring clock rather than on a default tween length', () => {
    // 曲线与时长必须成对地从同一根弹簧解出来。曾经这里传的是一个 GSAP 认不出来的
    // 插件名, 于是补间退回默认 500ms 匀速 —— 令牌给的时长与过冲一次都没生效, 而
    // 只断言曲线的话, 那条曲线压根不会被采样。
    rects = new Map(positionsOf(['a', 'b', 'c']));
    const { rerender } = render(<Stack keys={['a', 'b', 'c']} />);
    rects = new Map(positionsOf(['a', 'c']));
    rerender(<Stack keys={['a', 'c']} />);

    expect(tweenOf('c').duration()).toBeCloseTo(springSettleTime(reflowSpring(20)), 5);
  });

  it('would overshoot on the entrance token, which is why lists do not use it', () => {
    // 反向断言: 家族-进场令牌确实会过冲。没有这一条, "让位读自己的时序" 看起来只是
    // 口味选择, 而它实际是在避开一次真实的故障。
    rects = new Map(positionsOf(['a', 'b', 'c']));
    const { rerender } = render(<Stack keys={['a', 'b', 'c']} reflow={false} />);
    rects = new Map(positionsOf(['a', 'c']));
    rerender(<Stack keys={['a', 'c']} reflow={false} />);

    const curve = curveOf('c');
    expect(curve).toBeDefined();
    expect(peakOvershoot(curve!)).toBeGreaterThan(0);
  });

  it('hands the layer back when one reorder interrupts another', async () => {
    // 同一行连续两次换槽位: 第二次会 killTweensOf 掉第一次, 被杀的那段 onComplete 永不
    // 触发。引用计数因此必须由新的一段先归还 —— 否则计数停在 2, 图层永远留在行上。
    rects = new Map(positionsOf(['a', 'b', 'c']));
    const { rerender } = render(<Stack keys={['a', 'b', 'c']} />);
    const rowOf = () => document.querySelector<HTMLElement>('[data-flip-key="b"]')!;

    rects = new Map(positionsOf(['a', 'c', 'b']));
    rerender(<Stack keys={['a', 'c', 'b']} />);
    expect(promotionCount(rowOf())).toBe(1);

    rects = new Map(positionsOf(['a', 'b', 'c']));
    rerender(<Stack keys={['a', 'b', 'c']} />);
    expect(promotionCount(rowOf()), '被打断的那一段必须已归还').toBe(1);

    await waitFor(() => {
      expect(promotionCount(rowOf())).toBe(0);
      expect(rowOf().style.willChange).toBe('');
    });
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