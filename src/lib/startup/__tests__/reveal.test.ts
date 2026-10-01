//! 首帧放行 (reveal) 单测 — 顺序、幂等、兜底三条不变量。
//!
//! 放行顺序不可调换 (先 `show_main_window` 解除隐藏窗口节流 → 双 rAF 确认首帧
//! → `close_splashscreen`), 且全仓只有这一个入口 (连接诊断页与 App 共用)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMock } from '../../../test/setup';
import { revealMainWindow, resetRevealForTests } from '../reveal';

/// 手工 rAF ticker — 让"等两帧"这条时序在测试里完全确定
function installManualRaf() {
  const origRaf = globalThis.requestAnimationFrame;
  const origCaf = globalThis.cancelAnimationFrame;
  let queued: { id: number; cb: FrameRequestCallback }[] = [];
  let nextId = 1;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const id = nextId++;
    queued.push({ id, cb });
    return id;
  });
  globalThis.cancelAnimationFrame = ((id: number) => {
    queued = queued.filter((q) => q.id !== id);
  });
  const flush = () => {
    const items = queued.splice(0);
    for (const { cb } of items) cb(0);
  };
  return {
    flush,
    pending: () => queued.length,
    restore: () => {
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCaf;
    },
  };
}

/// transport.call 的命令名落到 tauriMock.invoke 是一条 Promise 链,
/// 断言前先排空微任务 (act 之外的纯异步), 否则调用"看起来"还没发生。
async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function shellCalls(): string[] {
  return (tauriMock.invoke.mock.calls as unknown as [string][])
    .map(([cmd]) => cmd)
    .filter((cmd) => cmd === 'show_main_window' || cmd === 'close_splashscreen');
}

let ticker: ReturnType<typeof installManualRaf>;

beforeEach(() => {
  ticker = installManualRaf();
  // 只接管 setTimeout — rAF 必须留在上面安装的手工队列里:
  // vi.useFakeTimers() 默认把 requestAnimationFrame 一起劫持到 sinon 的
  // 16ms 帧调度上, "等两帧" 的时序就不再由本测试控制。
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  tauriMock.invoke.mockClear();
  resetRevealForTests();
});

afterEach(() => {
  vi.useRealTimers();
  ticker.restore();
  resetRevealForTests();
});

describe('revealMainWindow', () => {
  it('先显示主窗口, 两帧之后才关闭启动页', async () => {
    revealMainWindow();

    // 第一步立即发生: show() 解除隐藏窗口的渲染节流
    await settled();
    expect(shellCalls()).toEqual(['show_main_window']);
    expect(ticker.pending()).toBe(1);

    ticker.flush(); // 第一次 rAF: show 已提交
    await settled();
    expect(shellCalls()).toEqual(['show_main_window']);
    expect(ticker.pending()).toBe(1);

    ticker.flush(); // 第二次 rAF: 首帧已合成 → 关启动页
    await settled();
    expect(shellCalls()).toEqual(['show_main_window', 'close_splashscreen']);
  });

  it('幂等 — 两条放行路径 (诊断页 / 设置加载完成) 只放行一次', async () => {
    revealMainWindow();
    ticker.flush();
    ticker.flush();

    // 再次放行 (如 App 的 settingsLoaded effect 迟到) 不产生任何新命令
    revealMainWindow();
    ticker.flush();
    await settled();
    expect(shellCalls()).toEqual(['show_main_window', 'close_splashscreen']);
  });

  it('兜底 — rAF 不回调 (后台标签页) 时 1500ms 后仍关闭启动页', async () => {
    revealMainWindow();
    await settled();
    expect(shellCalls()).toEqual(['show_main_window']);

    vi.advanceTimersByTime(1500);
    await settled();

    expect(shellCalls()).toEqual(['show_main_window', 'close_splashscreen']);
    // rAF 随后才到达也不再重复关 (close 幂等)
    ticker.flush();
    ticker.flush();
    expect(shellCalls()).toEqual(['show_main_window', 'close_splashscreen']);
  });

  it('rAF 先完成时, 兜底计时器不再二次关闭', async () => {
    revealMainWindow();
    ticker.flush();
    ticker.flush();
    await settled();
    expect(shellCalls()).toEqual(['show_main_window', 'close_splashscreen']);

    vi.advanceTimersByTime(2000);
    await settled();
    expect(shellCalls()).toEqual(['show_main_window', 'close_splashscreen']);
  });
});
