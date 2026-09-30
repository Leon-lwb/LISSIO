import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { RunControls } from '../RunControls';
import { useAppStore } from '../../../store/appStore';
import { api, type RecordingHealth } from '../../../lib/tauri/tauri';

const HEALTHY: RecordingHealth = {
  accepted_batches: 1,
  accepted_bytes: 8,
  persisted_batches: 1,
  persisted_bytes: 8,
  accepted_sequence: 0,
  persisted_sequence: 0,
  queued_batches: 0,
  failed: null,
};

/// 渲染并把健康查询的微任务冲刷完 — 状态更新必须落在 act 内
async function renderWithRunState(runState: 'running' | 'paused' | 'stopped') {
  await act(async () => {
    useAppStore.setState({ runState });
    render(<RunControls />);
    await Promise.resolve();
  });
}

describe('RunControls 录制中指示', () => {
  let health: MockInstance<typeof api.getRecordingHealth>;

  beforeEach(() => {
    health = vi.spyOn(api, 'getRecordingHealth').mockResolvedValue(HEALTHY);
    useAppStore.setState({ lang: 'zh', runState: 'stopped' });
  });

  afterEach(() => {
    cleanup();
    act(() => {
      useAppStore.setState({ runState: 'stopped' });
    });
    vi.restoreAllMocks();
  });

  it('暂停且录制健康时在按钮旁显示「录制中」', async () => {
    await renderWithRunState('paused');

    expect(screen.getByTestId('run-recording-active')).toBeTruthy();
    expect(screen.getByText('录制中')).toBeTruthy();
    expect(health).toHaveBeenCalledTimes(1);
  });

  it('录制不可用时不显示「录制中」', async () => {
    health.mockResolvedValue({ ...HEALTHY, failed: 'database is locked' });
    await renderWithRunState('paused');

    expect(health).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('run-recording-active')).toBeNull();
  });

  it('运行态与停止态不显示「录制中」', async () => {
    await renderWithRunState('running');
    expect(screen.queryByTestId('run-recording-active')).toBeNull();

    await renderWithRunState('stopped');
    expect(screen.queryByTestId('run-recording-active')).toBeNull();
    expect(health).not.toHaveBeenCalled();
  });
});
