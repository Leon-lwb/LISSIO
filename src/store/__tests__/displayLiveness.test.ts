import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({ setDisplayPushSuspended: vi.fn() }));

vi.mock('../../lib/rpc/livePushGate', () => ({
  setDisplayPushSuspended: gate.setDisplayPushSuspended,
}));

import {
  clearPanelFollowing,
  derivePanelLive,
  isPanelLive,
  onGoLive,
  reportPanelFollowing,
  requestGoLive,
  resetDisplayLiveness,
  setWorkspaceRunState,
  useDisplayLivenessStore,
} from '../displayLiveness';

describe('displayLiveness 显示时效派生层', () => {
  beforeEach(() => {
    gate.setDisplayPushSuspended.mockReset();
    resetDisplayLiveness();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('派生规则: 运行中且跟随最新才是及时显示', () => {
    expect(derivePanelLive('running', true)).toBe(true);
    expect(derivePanelLive('running', false)).toBe(false);
    expect(derivePanelLive('paused', true)).toBe(false);
    expect(derivePanelLive('stopped', true)).toBe(false);
  });

  it('工作区暂停冻结实时推送, 停止保留订阅', () => {
    setWorkspaceRunState('running');
    expect(gate.setDisplayPushSuspended).toHaveBeenLastCalledWith(false);

    setWorkspaceRunState('paused');
    expect(gate.setDisplayPushSuspended).toHaveBeenLastCalledWith(true);

    setWorkspaceRunState('stopped');
    expect(gate.setDisplayPushSuspended).toHaveBeenLastCalledWith(false);
    expect(useDisplayLivenessStore.getState().runState).toBe('stopped');
  });

  it('从暂停恢复广播跳最新; 停止→启动不广播', () => {
    const handler = vi.fn();
    const dispose = onGoLive('panel-1', handler);

    setWorkspaceRunState('running');
    setWorkspaceRunState('paused');
    expect(handler).not.toHaveBeenCalled();

    setWorkspaceRunState('running');
    expect(handler).toHaveBeenCalledTimes(1);

    // 停止 → 启动保持既有语义 (不跳最新)
    setWorkspaceRunState('stopped');
    setWorkspaceRunState('running');
    expect(handler).toHaveBeenCalledTimes(1);

    // 同态重复设置不广播
    setWorkspaceRunState('running');
    expect(handler).toHaveBeenCalledTimes(1);

    dispose();
    requestGoLive();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('面板上报跟随状态并驱动时效判定', () => {
    setWorkspaceRunState('running');
    expect(isPanelLive('w1')).toBe(true);

    reportPanelFollowing('w1', false);
    expect(isPanelLive('w1')).toBe(false);

    reportPanelFollowing('w1', true);
    expect(isPanelLive('w1')).toBe(true);

    reportPanelFollowing('w2', false);
    expect(isPanelLive('w2')).toBe(false);

    clearPanelFollowing('w2');
    expect(isPanelLive('w2')).toBe(true);
  });
});
