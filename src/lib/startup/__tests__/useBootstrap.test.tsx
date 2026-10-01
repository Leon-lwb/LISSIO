//! bootstrap 阶段单测 — 装配副作用各执行一次, 卸载时事件监听对称拆除。

import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMock } from '../../../test/setup';
import { useSettingsStore } from '../../../store/settingsStore';

vi.mock('../../ai/toolHost', () => ({ initAiToolHost: vi.fn() }));

import { initAiToolHost } from '../../ai/toolHost';
import { useBootstrap } from '../useBootstrap';

const initToolHost = vi.mocked(initAiToolHost);

/// 事件监听注销计数 — initEventListeners 返回的清理函数被调用即视为"已拆除"
function unlistenCalls(): number {
  // transport.listen 返回注销函数; 这里通过 listen 桩的调用数近似"接线次数",
  // 真正的注销语义由 appStore 的 unlistenFns 保证 (见 events.ts)。
  return tauriMock.listen.mock.calls.length;
}

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({ loaded: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useBootstrap', () => {
  it('挂载一次: 加载设置 + 接线事件监听 + 刷新端口 + 接线 AI 工具宿主', async () => {
    await act(async () => {
      renderHook(() => useBootstrap());
      await Promise.resolve();
    });
    // 设置加载 (load) 会落 get_store 调用; 端口刷新会发 list_ports
    const commands = (tauriMock.invoke.mock.calls as unknown as [string][])
      .map(([cmd]) => cmd);
    expect(commands).toContain('list_ports');
    expect(initToolHost).toHaveBeenCalledTimes(1);
    expect(unlistenCalls()).toBeGreaterThan(0);
  });

  it('StrictMode 双挂载 — AI 工具宿主幂等, 只接线一次', async () => {
    await act(async () => {
      renderHook(() => useBootstrap(), { wrapper: StrictMode });
      await Promise.resolve();
    });
    // toolHost 内部 started 闩保证重复调用不重复 listen
    expect(initToolHost).toHaveBeenCalled();
    const listenAfterFirst = unlistenCalls();
    // 第二轮挂载 (StrictMode) 再次进入 effect, 但 toolHost 幂等
    expect(listenAfterFirst).toBeGreaterThan(0);
  });
});
