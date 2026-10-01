//! workspace 阶段单测 — 描述同步与启动种子的放行条件。
//!
//! 屏障语义: `workspaceReady=false` (工作区未水合) 时什么都不做;
//! 就绪后按 `workspaceRestored` 决定是否补种子, 并对称 start/stop describe 同步。

import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/appStore';
import type * as DescribeStoreModule from '../../models/describeStore';
import { resetDescribeForTests } from '../../models/describeStore';

vi.mock('../../models/describeStore', async (importOriginal) => {
  const actual = await importOriginal<typeof DescribeStoreModule>();
  return {
    ...actual,
    startDescribeSync: vi.fn(actual.startDescribeSync),
    stopDescribeSync: vi.fn(actual.stopDescribeSync),
  };
});

vi.mock('../../models/startupSeed', () => ({
  seedStartupWorkspace: vi.fn(() => Promise.resolve()),
}));

import { startDescribeSync as startSpy, stopDescribeSync as stopSpy }
  from '../../models/describeStore';
import { seedStartupWorkspace } from '../../models/startupSeed';
import { useWorkspaceSeed } from '../useWorkspaceSeed';

const seedMock = vi.mocked(seedStartupWorkspace);

beforeEach(() => {
  resetDescribeForTests();
  vi.clearAllMocks();
  useAppStore.setState({ workspaceReady: false, workspaceRestored: false, rfNodes: [], rfEdges: [] });
});

afterEach(() => {
  resetDescribeForTests();
  vi.clearAllMocks();
});

describe('useWorkspaceSeed', () => {
  it('工作区未就绪时不启动描述同步, 也不创建种子', () => {
    renderHook(() => useWorkspaceSeed());
    expect(startSpy).not.toHaveBeenCalled();
    expect(seedMock).not.toHaveBeenCalled();
  });

  it('就绪且未水合 (默认启动) — 启动描述同步并创建一次种子', async () => {
    const { rerender } = renderHook(() => useWorkspaceSeed());
    await act(async () => {
      useAppStore.setState({ workspaceReady: true, workspaceRestored: false });
      rerender();
      await Promise.resolve();
    });
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(seedMock).toHaveBeenCalledTimes(1);
  });

  it('就绪且已水合 (恢复工作区) — 启动描述同步但不创建种子', async () => {
    const { rerender } = renderHook(() => useWorkspaceSeed());
    await act(async () => {
      useAppStore.setState({ workspaceReady: true, workspaceRestored: true });
      rerender();
      await Promise.resolve();
    });
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(seedMock).not.toHaveBeenCalled();
  });

  it('卸载时对称拆除描述同步 (StrictMode 双挂载安全)', async () => {
    const { unmount } = renderHook(() => useWorkspaceSeed(), { wrapper: StrictMode });
    await act(async () => {
      useAppStore.setState({ workspaceReady: true, workspaceRestored: false });
      await Promise.resolve();
    });
    unmount();
    expect(stopSpy).toHaveBeenCalled();
  });
});
