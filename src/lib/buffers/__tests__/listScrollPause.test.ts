import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import { useAppStore } from '../../../store/appStore';
import { api } from '../../tauri/tauri';
import {
  listScrollPauseHolders,
  listScrollPauseOwned,
  useListScrollPause,
} from '../listScrollPause';
import type { RunAction } from '../../../types';

/// 后端动作 → 运行态镜像 (与 Rust workspace_run 返回值同形)
function mockWorkspaceRun() {
  return vi.spyOn(api, 'workspaceRun').mockImplementation((action: RunAction) =>
    Promise.resolve({ state: action === 'pause' ? 'paused' : 'running', epoch: 1 }));
}

/// 冲刷一次微任务队列 — workspaceRun 是异步命令, 运行态镜像在其返回后更新
const settle = () => act(() => Promise.resolve());

/// 渲染一个列表面板: detached 由测试驱动, 与真实面板"上滚 ↔ 回到底部"一致
function renderPanel(runState: 'running' | 'paused' | 'stopped') {
  useAppStore.setState({ runState });
  return renderHook(
    ({ detached }: { detached: boolean }) => useListScrollPause('panel-a', detached),
    { initialProps: { detached: false } }
  );
}

describe('listScrollPause - 列表面板上滚触发工作区暂停', () => {
  beforeEach(() => {
    useAppStore.setState({ runState: 'stopped' });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAppStore.setState({ runState: 'stopped' });
  });

  it('上滚即暂停工作区, 回到底部自动恢复', async () => {
    const run = mockWorkspaceRun();
    const { rerender } = renderPanel('running');

    act(() => {
      rerender({ detached: true });
    });
    await settle();
    expect(run).toHaveBeenCalledWith('pause');
    expect(useAppStore.getState().runState).toBe('paused');
    expect(listScrollPauseHolders()).toEqual(['panel-a']);

    act(() => {
      rerender({ detached: false });
    });
    await settle();
    expect(run).toHaveBeenCalledWith('start');
    expect(useAppStore.getState().runState).toBe('running');
    expect(listScrollPauseHolders()).toEqual([]);
    expect(listScrollPauseOwned()).toBe(false);
  });

  it('面板卸载 (关闭卡片) 即释放, 不会把工作区永久留在暂停', async () => {
    mockWorkspaceRun();
    const { rerender, unmount } = renderPanel('running');
    act(() => {
      rerender({ detached: true });
    });
    await settle();
    expect(useAppStore.getState().runState).toBe('paused');

    act(() => {
      unmount();
    });
    await settle();
    expect(useAppStore.getState().runState).toBe('running');
  });

  it('工作区未运行时上滚: 不产生任何运行态动作', async () => {
    const run = mockWorkspaceRun();
    const { rerender } = renderPanel('stopped');

    act(() => {
      rerender({ detached: true });
    });
    await settle();
    expect(run).not.toHaveBeenCalled();
    expect(useAppStore.getState().runState).toBe('stopped');
    expect(listScrollPauseOwned()).toBe(false);

    act(() => {
      rerender({ detached: false });
    });
    await settle();
    expect(run).not.toHaveBeenCalled();
  });

  it('用户手动停止后回到底部: 不自动重新启动', async () => {
    mockWorkspaceRun();
    const { rerender } = renderPanel('running');
    act(() => {
      rerender({ detached: true });
    });
    await settle();
    expect(useAppStore.getState().runState).toBe('paused');

    // 用户在暂停期间手动停止
    act(() => {
      useAppStore.setState({ runState: 'stopped' });
    });
    act(() => {
      rerender({ detached: false });
    });
    await settle();
    expect(useAppStore.getState().runState).toBe('stopped');
  });

  it('用户手动恢复运行后回到底部: 不再重复 start', async () => {
    const run = mockWorkspaceRun();
    const { rerender } = renderPanel('running');
    act(() => {
      rerender({ detached: true });
    });
    await settle();

    // 用户手动启动 (覆盖本次滚动暂停 → 放弃归属)
    act(() => {
      useAppStore.setState({ runState: 'running' });
    });
    act(() => {
      rerender({ detached: false });
    });
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('pause');
  });
});
