import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScrollFollow } from '../useScrollFollow';

import type { ScrollTarget } from '../useScrollFollow';

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

describe('useScrollFollow - 平滑自动滚动', () => {
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
    const { result } = renderHook(() => useScrollFollow(true, () => el));

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

  it('大距离: 逐帧连续追赶, 不做整屏跳变 (跟随刷新不再整屏替换可见内容)', () => {
    const el = fakeEl(0, 3000, 100); // 落后 2900px — 流式跟随的常见落后量
    const { result } = renderHook(() => useScrollFollow(true, () => el));

    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(1);

    act(() => {
      flushFrames(1);
    });
    // 第一帧只走剩余距离的固定比例 — 一帧跳满整屏会让每次数据刷新都替换可见内容
    expect(el.scrollTop).toBeGreaterThan(0);
    expect(el.scrollTop).toBeLessThan(2900);
    expect(pendingCount()).toBe(1);

    act(() => {
      flushFrames(30);
    });
    expect(el.scrollTop).toBe(2900);
    expect(pendingCount()).toBe(0);
  });

  it('落后到追赶无意义 (超过 20000px): 瞬时跳底, 不做长时间追赶', () => {
    const el = fakeEl(0, 30_000, 100); // target = 29900
    const { result } = renderHook(() => useScrollFollow(true, () => el));

    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(1);
    act(() => {
      flushFrames(1);
    });
    expect(el.scrollTop).toBe(29_900);
    expect(pendingCount()).toBe(0);
  });

  it('已在底部 / enabled=false / 用户上滚时 scheduleToBottom 不启动', () => {
    const pinned = fakeEl(400, 500, 100); // target = 400
    const { result } = renderHook(() => useScrollFollow(true, () => pinned));
    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(0);

    const off = fakeEl(0, 500, 100);
    const offCtrl = renderHook(() => useScrollFollow(false, () => off));
    act(() => {
      offCtrl.result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(0);
    expect(off.scrollTop).toBe(0);

    const scrolledUp = fakeEl(0, 500, 100);
    const upCtrl = renderHook(() => useScrollFollow(true, () => scrolledUp));
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
    const { result } = renderHook(() => useScrollFollow(true, () => el));
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
    const { result } = renderHook(() => useScrollFollow(true, () => el));
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
    const { result } = renderHook(() => useScrollFollow(true, () => el));
    act(() => {
      result.current.scheduleToBottom();
    });
    expect(el.scrollTop).toBe(150);
    expect(pendingCount()).toBe(0);
  });

  it('enabled 变 false 时停掉进行中的动画', () => {
    const el = fakeEl(0, 250, 100);
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useScrollFollow(enabled, () => el),
      { initialProps: { enabled: true } }
    );
    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(1);
    rerender({ enabled: false });
    expect(pendingCount()).toBe(0);
  });

  it('detached 是上滚标记的响应式镜像 (供"回到最新"按钮显示)', () => {
    const el = fakeEl(400, 500, 100); // 恰在底部
    const { result } = renderHook(() => useScrollFollow(true, () => el));
    expect(result.current.detached).toBe(false);

    act(() => {
      el.scrollTop = 100;
      result.current.handleScroll();
    });
    expect(result.current.detached).toBe(true);
    expect(result.current.userScrolledRef.current).toBe(true);

    // 用户自己滚回底部 → 标记与按钮同时熄灭
    act(() => {
      el.scrollTop = 400;
      result.current.handleScroll();
    });
    expect(result.current.detached).toBe(false);
    expect(result.current.userScrolledRef.current).toBe(false);

    // 主动复位 (清空/切通道) 同样清掉按钮
    act(() => {
      el.scrollTop = 0;
      result.current.handleScroll();
    });
    expect(result.current.detached).toBe(true);
    act(() => {
      result.current.resetUserScroll();
    });
    expect(result.current.detached).toBe(false);
  });

  it('jumpToLatest: 瞬时跳回最新并恢复跟随 (脱离期间不追赶)', () => {
    const el = fakeEl(0, 100_000, 100);
    const { result } = renderHook(() => useScrollFollow(true, () => el));

    act(() => {
      result.current.handleScroll(); // 远离底部 → 脱离
    });
    expect(result.current.detached).toBe(true);

    // 脱离状态下数据帧不得把视口拽走
    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(0);
    expect(el.scrollTop).toBe(0);

    act(() => {
      result.current.jumpToLatest();
    });
    // 跨十万像素一次写完: 分帧追赶会被持续到达的新数据不断推远
    expect(el.scrollTop).toBe(99_900);
    expect(result.current.detached).toBe(false);
    expect(result.current.userScrolledRef.current).toBe(false);
    expect(pendingCount()).toBe(0);

    // 恢复跟随后新数据可再次追底
    el.scrollHeight = 100_200;
    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(1);
  });

  it('jumpToLatest 取消进行中的追底动画', () => {
    const el = fakeEl(0, 250, 100);
    const { result } = renderHook(() => useScrollFollow(true, () => el));
    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(1);

    act(() => {
      result.current.jumpToLatest();
    });
    expect(pendingCount()).toBe(0);
    expect(el.scrollTop).toBe(150);
  });

  it('滞后到达的自身写入事件不算用户接管 (跟随不半途中断)', () => {
    const el = fakeEl(0, 250, 100); // target = 150
    const { result } = renderHook(() => useScrollFollow(true, () => el));
    act(() => {
      result.current.scheduleToBottom();
    });
    act(() => {
      flushFrames(1);
    });
    const staleWrite = el.scrollTop;
    expect(staleWrite).toBeGreaterThan(0);

    // 内容继续增长把视口推离最新; 此刻 scroll 事件才带着上一帧的写入值到达
    el.scrollHeight = 400;
    act(() => {
      result.current.handleScroll();
    });
    // 滞后事件与本 hook 的写入一致 → 不是接管, 追赶继续
    expect(result.current.userScrolledRef.current).toBe(false);
    expect(pendingCount()).toBe(1);
  });

  it('动画收敛后数据增长: 滞后写入事件不误判上滚, 真实上滚仍能脱离', () => {
    const el = fakeEl(0, 250, 100);
    const { result } = renderHook(() => useScrollFollow(true, () => el));
    act(() => {
      result.current.scheduleToBottom();
    });
    act(() => {
      flushFrames(30);
    });
    expect(el.scrollTop).toBe(150);
    expect(pendingCount()).toBe(0);

    // 新数据到达 (视口被动推离) + 上一帧写入的 scroll 事件此时才派发
    el.scrollHeight = 320;
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.detached).toBe(false);

    act(() => {
      el.scrollTop = 10;
      result.current.handleScroll();
    });
    expect(result.current.detached).toBe(true);
    expect(result.current.userScrolledRef.current).toBe(true);
  });

  it('上滚输入立即让位: 数据持续到达也不再抢回视口 (高频流下"滚不动")', () => {
    const el = fakeEl(0, 500, 100); // target = 400
    const { result } = renderHook(() => useScrollFollow(true, () => el));
    act(() => {
      result.current.scheduleToBottom();
    });
    act(() => {
      flushFrames(1);
    });
    const chasing = el.scrollTop;
    expect(chasing).toBeGreaterThan(0);

    // 滚轮上滚: 输入事件先到, scroll 事件随后异步派发
    act(() => {
      result.current.handleUserScrollIntent(true);
    });
    expect(pendingCount()).toBe(0);
    expect(result.current.userScrolledUp).toBe(true);

    // 数据继续到达, 但视口不再被拽回最新
    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(0);

    // 用户位置生效 → scroll 事件归属用户 (视口脱离最新)
    act(() => {
      el.scrollTop = chasing - 60;
      result.current.handleScroll();
    });
    expect(result.current.detached).toBe(true);
    expect(result.current.userScrolledRef.current).toBe(true);

    // 视口滑到底部只恢复跟随显示, 平台侧"用户上滚"仍在 → 工作区保持暂停语义
    act(() => {
      el.scrollTop = 400;
      result.current.handleScroll();
    });
    expect(result.current.detached).toBe(false);
    expect(result.current.userScrolledUp).toBe(true);
    el.scrollHeight = 600;
    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(0);

    // 显式回到最新 (按钮/重新开启自动滚动) 才解除并恢复追底
    act(() => {
      result.current.resetUserScroll();
    });
    expect(result.current.userScrolledUp).toBe(false);
    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(1);
  });

  it('朝最新的滚动输入不阻断跟随', () => {
    const el = fakeEl(0, 500, 100);
    const { result } = renderHook(() => useScrollFollow(true, () => el));

    act(() => {
      result.current.handleUserScrollIntent(false);
    });
    expect(result.current.userScrolledUp).toBe(false);
    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(1);
  });

  it('内容不足一屏时的上滚输入不触发暂停也不停掉跟随', () => {
    const el = fakeEl(0, 80, 100); // 无滚动余量
    const { result } = renderHook(() => useScrollFollow(true, () => el));

    act(() => {
      result.current.handleUserScrollIntent(true);
      result.current.scheduleToBottom();
    });
    // 没有可滚动余量 → 上滚改变不了视口, 不算离开最新
    expect(result.current.userScrolledUp).toBe(false);
    expect(pendingCount()).toBe(0);

    el.scrollHeight = 500; // 数据增长到可滚动
    act(() => {
      result.current.scheduleToBottom();
    });
    expect(pendingCount()).toBe(1);
    act(() => {
      flushFrames(40);
    });
    expect(el.scrollTop).toBe(400);
  });

  it('位置变小 (拖滚动条上滚) 同样触发"用户上滚"', () => {
    const el = fakeEl(300, 500, 100); // 远离底部
    const { result } = renderHook(() => useScrollFollow(true, () => el));
    expect(result.current.userScrolledUp).toBe(false);

    act(() => {
      result.current.handleScroll(); // 首个事件只记录基线
    });
    expect(result.current.userScrolledUp).toBe(false);

    act(() => {
      el.scrollTop = 200; // 向上拖滚动条: 位置变小
      result.current.handleScroll();
    });
    expect(result.current.userScrolledUp).toBe(true);
    expect(result.current.detached).toBe(true);
  });

  it('jumpToLatest 解除"用户上滚"约束 (显式回到最新)', () => {
    const el = fakeEl(300, 100_000, 100);
    const { result } = renderHook(() => useScrollFollow(true, () => el));
    act(() => {
      result.current.handleUserScrollIntent(true);
    });
    expect(result.current.userScrolledUp).toBe(true);

    act(() => {
      result.current.jumpToLatest();
    });
    expect(result.current.userScrolledUp).toBe(false);
    expect(result.current.detached).toBe(false);
    expect(el.scrollTop).toBe(99_900);
  });
});
