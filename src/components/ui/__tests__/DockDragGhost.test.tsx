import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';

// dockStore/layoutStore 的 persist 中间件需要 localStorage — 在导入 store 前提供内存桩
vi.hoisted(() => {
  const store = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  const g = globalThis as { localStorage?: unknown };
  g.localStorage = localStorageMock;
});

import { dockDrag, __resetForTests, subscribeGhost, type GhostState } from '../../../lib/dockDrag';
import { MOMENTUM_FLOOR_PX_S } from '../../../lib/motion';
import { DockDragGhost } from '../DockDragGhost';

function moveTo(x: number, y: number) {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, button: 0 }));
}

function release() {
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: 0, clientY: 0, button: 0 }));
}

/** 读出幽灵的 transform 位移 — 位置由 GSAP 写进 style.transform, 不再是 left/top */
function offsetOf(node: HTMLElement): { x: number; y: number } {
  const match = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)/.exec(node.style.transform ?? '');
  return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 };
}

describe('DockDragGhost 渲染', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    __resetForTests();
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    document.elementFromPoint = () => null;
    act(() => {
      createRoot(container).render(createElement(DockDragGhost));
    });
  });

  it('拖拽激活后幽灵显示, 且以指针坐标定位', () => {
    expect(container.querySelector('[aria-hidden]')).toBeNull();
    act(() => {
      dockDrag.begin({ clientX: 10, clientY: 10, button: 0 }, { kind: 'sidebar', label: 'Sidebar' });
      moveTo(100, 100);
    });
    const ghost = container.querySelector<HTMLElement>('[aria-hidden]');
    expect(ghost).not.toBeNull();
    // 位置走 transform 而不是 left/top —— 拖拽期间每帧改坐标, 落在 left/top 上
    // 就是每帧一次布局
    expect(ghost!.style.left).toBe('');
    expect(ghost!.style.top).toBe('');
    expect(offsetOf(ghost!)).toEqual({ x: 100, y: 100 });
  });
});

describe('松手时的动量交接', () => {
  let seen: GhostState | null;
  let clock: number;

  beforeEach(() => {
    __resetForTests();
    document.body.innerHTML = '';
    document.elementFromPoint = () => null;
    seen = null;
    clock = 0;
    // 松手速度由最近 90ms 内的指针位移算出, 所以测试必须自己推进时钟 ——
    // 否则所有采样都落在同一毫秒里, 速度退化成无穷大, 每种力度都撞上航程上限。
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    subscribeGhost((state) => {
      seen = state;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('释放态借出合成器图层, 拖拽途中不借 — 图层只在真正有动画时存在', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => {
      createRoot(host).render(createElement(DockDragGhost));
    });
    act(() => {
      dockDrag.begin({ clientX: 0, clientY: 0, button: 0 }, { kind: 'sidebar', label: 'Dragged' });
      for (let i = 1; i <= 6; i += 1) {
        clock += 16;
        moveTo(i * 30, i * 30);
      }
    });
    const ghost = host.querySelector<HTMLElement>('[aria-hidden]')!;
    expect(ghost).not.toBeNull();
    // 拖拽途中只是逐帧改 transform, 没有补间, 不需要独立图层
    expect(ghost.style.willChange).toBe('');

    act(() => release());
    expect(ghost.style.willChange).toContain('transform');
  });

  /**
   * 连续甩动后松手, 返回松手瞬间的幽灵状态。
   * 速度 ≈ stepPx·√2 / 每步毫秒数, 改 stepPx 就是在改甩的力度。
   */
  function fling(steps: number, stepPx: number, msPerStep = 16) {
    act(() => {
      dockDrag.begin({ clientX: 0, clientY: 0, button: 0 }, { kind: 'sidebar', label: 'Dragged' });
      for (let i = 1; i <= steps; i += 1) {
        clock += msPerStep;
        moveTo(i * stepPx, i * stepPx);
      }
    });
    act(() => release());
    return seen;
  }

  const reachOf = (ghost: GhostState | null) => Math.hypot(ghost!.release!.dx, ghost!.release!.dy);

  it('甩出去时幽灵带着动量前冲, 方向与松手速度一致', () => {
    const ghost = fling(8, 90);
    expect(ghost?.release).toBeDefined();
    // 只断言方向与"确实发生了位移", 不锁死像素数
    expect(ghost!.release!.dx).toBeGreaterThan(0);
    expect(ghost!.release!.dy).toBeGreaterThan(0);
    expect(ghost!.release!.initialVelocity).toBeGreaterThan(0);
    expect(ghost!.release!.durationMs).toBeGreaterThan(0);
  });

  it('甩得越狠前冲越远 — 两种力度都取在航程上限以内, 才能看出递进', () => {
    const light = fling(6, 12);
    const heavy = fling(6, 30);
    expect(reachOf(heavy)).toBeGreaterThan(reachOf(light));
  });

  it('航程有上限: 荒唐的甩动速度不会把幽灵甩出屏幕', () => {
    const absurd = fling(20, 900);
    expect(reachOf(absurd)).toBeLessThan(200);
  });

  it('松手后幽灵仍带着释放态存在, 而不是瞬时消失', () => {
    act(() => {
      dockDrag.begin({ clientX: 0, clientY: 0, button: 0 }, { kind: 'sidebar', label: 'Dragged' });
      clock += 16;
      moveTo(200, 0);
    });
    act(() => release());
    expect(seen?.release).toBeDefined();
  });

  it('指针停住再松手属于"放稳了": 只有原地放大淡出, 不产生前冲', () => {
    act(() => {
      dockDrag.begin({ clientX: 0, clientY: 0, button: 0 }, { kind: 'sidebar', label: 'Dragged' });
      clock += 16;
      moveTo(400, 400);
    });
    act(() => release());
    expect(seen?.release?.dx).toBe(0);
    expect(seen?.release?.dy).toBe(0);
    expect(seen?.release?.initialVelocity).toBe(0);
  });

  it('低速甩动仍在动量下限之下, 与"放稳了"一致', () => {
    // 12px/步 · 16ms/步 ≈ 1060px/s... 需要更慢: 2px/步 ≈ 177px/s, 远低于下限
    const slow = fling(6, 2);
    expect(reachOf(slow)).toBe(0);
    expect(MOMENTUM_FLOOR_PX_S).toBeGreaterThan(0);
  });
});