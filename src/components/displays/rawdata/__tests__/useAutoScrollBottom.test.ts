import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoScrollBottom } from '../useAutoScrollBottom';

import type { ScrollTarget } from '../useAutoScrollBottom';

/// 可编程的假滚动容器 (hook 只依赖 scrollTop/scrollHeight/clientHeight 三属性)
function fakeEl(scrollTop: number, scrollHeight: number, clientHeight: number): ScrollTarget {
  return { scrollTop, scrollHeight, clientHeight };
}

/// 确定性 rAF 桩: 手动逐帧驱动
let rafQueue: Map<number, () => void>;
let rafSeq: number;
function flushFrames(n: number) {
  for (let i = 0; i < n; i++) {
    const entry = rafQueue.entries().next();
    if (entry.done) return;
    const [id, cb] = entry.value;
    rafQueue.delete(id);
    cb();
  }
}
function pendingCount(): number {
  return rafQueue.size;
}

describe('useAutoScrollBottom - 平滑自动滚动', () => {
  beforeEach(() => {
    rafQueue = new Map();
    rafSeq = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      rafSeq += 1;
      rafQueue.set(rafSeq, cb);
      return rafSeq;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafQueue.delete(id);
    });
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('小距离: rAF 指数逼近收敛到底部后停止', () => {
    const el = fakeEl(0, 250, 100); // target = 150, 距离 150 < 2 屏 → 平滑
    const { result } = renderHook(() => useAutoScrollBottom(true, () => el));

    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(1);

    act(() => {
      flushFrames(30);
    });
    expect(el.scrollTop).toBe(150);
    expect(pendingCount()).toBe(0);
  });

  it('大距离 (>2 屏): 瞬间跳底不追赶', () => {
    const el = fakeEl(0, 3000, 100); // target = 2900 > 200
    const { result } = renderHook(() => useAutoScrollBottom(true, () => el));

    act(() => {
      result.current.scheduleToBottom();
    });
    // 启动帧后第一帧即吸附: 仅剩启动帧未执行
    expect(pendingCount()).toBe(1);
    act(() => {
      flushFrames(1);
    });
    expect(el.scrollTop).toBe(2900);
    expect(pendingCount()).toBe(0);
  });

  it('已在底部 / enabled=false / 用户上滚时 scheduleToBottom 不启动', () => {
    const pinned = fakeEl(400, 500, 100); // target = 400
    const { result } = renderHook(() => useAutoScrollBottom(true, () => pinned));
    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(0);

    const off = fakeEl(0, 500, 100);
    const offCtrl = renderHook(() => useAutoScrollBottom(false, () => off));
    act(() => {
      offCtrl.result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(0);
    expect(off.scrollTop).toBe(0);

    const scrolledUp = fakeEl(0, 500, 100);
    const upCtrl = renderHook(() => useAutoScrollBottom(true, () => scrolledUp));
    act(() => {
      upCtrl.result.current.handleScroll(); // 不在底部 → 归属用户滚动
    });
    expect(upCtrl.result.current.userScrolledRef.current).toBe(true);
    act(() => {
      upCtrl.result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(0);
  });

  it('动画中用户接管 (滚动位置大幅偏离) → 取消动画并标记上滚', () => {
    const el = fakeEl(0, 250, 100);
    const { result } = renderHook(() => useAutoScrollBottom(true, () => el));
    act(() => {
      result.current.scheduleToBottom();
    });
    act(() => {
      flushFrames(2);
    });
    expect(el.scrollTop).toBeGreaterThan(0);

    // 模拟用户拖动滚动条到顶部
    act(() => {
      el.scrollTop = 0;
      result.current.handleScroll();
    });
    expect(result.current.userScrolledRef.current).toBe(true);
    const frozen = el.scrollTop;
    act(() => {
      flushFrames(10);
    });
    expect(el.scrollTop).toBe(frozen);
    expect(pendingCount()).toBe(0);
  });

  it('在底部时滚动归属不误标上滚; resetUserScroll 恢复追底', () => {
    const el = fakeEl(400, 500, 100); // 恰在底部 (距离 0 < 30)
    const { result } = renderHook(() => useAutoScrollBottom(true, () => el));
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.userScrolledRef.current).toBe(false);

    // 用户上滚 → 标记 → resetUserScroll 清除后可继续追底
    act(() => {
      el.scrollTop = 100;
      result.current.handleScroll();
    });
    expect(result.current.userScrolledRef.current).toBe(true);
    act(() => {
      result.current.resetUserScroll();
    });
    expect(result.current.userScrolledRef.current).toBe(false);
    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(1);
  });

  it('prefers-reduced-motion: 跳过动画直接跳底', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const el = fakeEl(0, 250, 100);
    const { result } = renderHook(() => useAutoScrollBottom(true, () => el));
    act(() => {
      result.current.scheduleToBottom();
    });
    expect(el.scrollTop).toBe(150);
    expect(pendingCount()).toBe(0);
  });

  it('enabled 变 false 时停掉进行中的动画', () => {
    const el = fakeEl(0, 250, 100);
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useAutoScrollBottom(enabled, () => el),
      { initialProps: { enabled: true } }
    );
    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(1);
    rerender({ enabled: false });
    expect(pendingCount()).toBe(0);
  });
});
