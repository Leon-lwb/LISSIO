import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { motionIsReduced, setReducedMotionSetting } from '../reducedMotion';
import { STAGGER_CAP_MS, STAGGER_STEP_MS, staggerDelayMs, useStaggerEntrance } from '../stagger';

// 断言的是顺序与封顶这类空间关系, 不是具体毫秒数 —— 毫秒数会随调参变化,
// 断言它必然在调参时失败。

describe('staggerDelayMs', () => {
  afterEach(() => setReducedMotionSetting(false));

  it('第 0 项不延迟, 封顶之前的项依次靠后', () => {
    expect(staggerDelayMs(0)).toBe(0);
    // 只在封顶之前断言严格递增 —— 越过后多项共享同一个延迟, 由下面那条用例负责
    for (let i = 1; i * STAGGER_STEP_MS < STAGGER_CAP_MS; i += 1) {
      expect(staggerDelayMs(i)).toBeGreaterThan(staggerDelayMs(i - 1));
    }
  });

  it('封顶后不再继续累加 — 长列表末尾不能被推迟到读完之后', () => {
    const cap = staggerDelayMs(999);
    expect(cap).toBe(STAGGER_CAP_MS);
    expect(staggerDelayMs(50)).toBe(cap);
    expect(staggerDelayMs(5000)).toBe(cap);
    // 封顶必须真的被触达, 否则这条断言只是在测一个够不着的分支
    expect(staggerDelayMs(1) * 999).toBeGreaterThan(cap);
  });

  it('间隔越大, 同样两项之间的距离越远', () => {
    const near = staggerDelayMs(4, { stepMs: 10 });
    const far = staggerDelayMs(4, { stepMs: 30 });
    expect(far).toBeGreaterThan(near);
  });

  it('负索引与非法输入退化成第一项, 不产生负延迟', () => {
    for (const index of [-1, -999, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(staggerDelayMs(index)).toBe(0);
    }
  });

  it('低动画偏好下完全不延迟 — 令牌已压成 1ms, 错峰只会留下空白帧', () => {
    setReducedMotionSetting(true);
    expect(motionIsReduced()).toBe(true);
    for (let i = 0; i < 40; i += 1) expect(staggerDelayMs(i)).toBe(0);
  });

  it('关闭低动画偏好后延迟恢复', () => {
    setReducedMotionSetting(true);
    setReducedMotionSetting(false);
    expect(staggerDelayMs(3)).toBeGreaterThan(0);
  });
});

describe('useStaggerEntrance', () => {
  it('返回的解析器保持稳定身份, 可以直接传给 memo 化的行组件', () => {
    const { result, rerender } = renderHook(() => useStaggerEntrance());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('解析器与直接调用同口径', () => {
    const options = { stepMs: 12, capMs: 40 };
    const { result } = renderHook(() => useStaggerEntrance(options));
    for (let i = 0; i < 8; i += 1) {
      expect(result.current(i)).toBe(staggerDelayMs(i, options));
    }
  });
});