import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AcrylicGuardState,
  LOW_FPS_SAMPLES,
  WARMUP_SAMPLES,
  startAcrylicPerformanceGuard,
} from '../acrylicGuard';
import { notify } from '../../tauri/notifications';
import { usePerformanceStore } from '../../../store/performanceStore';
import { useSettingsStore } from '../../../store/settingsStore';
import type { FrontendPerformanceSnapshot } from '../../../types';

/// 预热 + 连续低帧率 = 触发提醒所需的最少采样点数 (每点约 1s)
const SAMPLES_TO_TRIGGER = WARMUP_SAMPLES + LOW_FPS_SAMPLES;

function sample(fps: number, at = 0): FrontendPerformanceSnapshot {
  return {
    sampledAtMs: at,
    fps,
    frameTimeAverageMs: fps > 0 ? 1_000 / fps : 0,
    frameTimeP95Ms: 0,
    longTasksPerSecond: 0,
    longestTaskMs: 0,
    jsHeapUsedBytes: null,
    jsHeapLimitBytes: null,
    monitorRpcLatencyMs: null,
  };
}

describe('acrylic guard state machine', () => {
  it('skips the startup warmup window', () => {
    const guard = new AcrylicGuardState();
    const fired = Array.from({ length: WARMUP_SAMPLES }, () => guard.observe(10, true));

    expect(fired.some(Boolean)).toBe(false);
  });

  it('fires once after consecutive low-fps samples', () => {
    const guard = new AcrylicGuardState();
    const fired = Array.from({ length: SAMPLES_TO_TRIGGER }, () => guard.observe(20, true));

    expect(fired.filter(Boolean)).toHaveLength(1);
    expect(fired[fired.length - 1]).toBe(true);
    // 本会话已提醒过: 持续卡顿也不再打扰
    expect(guard.observe(20, true)).toBe(false);
  });

  it('requires consecutive low-fps samples, a healthy frame resets the streak', () => {
    const guard = new AcrylicGuardState();
    for (let i = 0; i < WARMUP_SAMPLES; i += 1) guard.observe(60, true);

    expect(guard.observe(30, true)).toBe(false);
    expect(guard.observe(60, true)).toBe(false); // 恢复 → 重新计数
    expect(guard.observe(30, true)).toBe(false);
    expect(guard.observe(30, true)).toBe(true);
  });

  it('ignores stalled frames: fps 0 means rAF paused, not a stutter', () => {
    const guard = new AcrylicGuardState();
    for (let i = 0; i < SAMPLES_TO_TRIGGER + 2; i += 1) {
      expect(guard.observe(0, true)).toBe(false);
    }
  });

  it('does not spend the once-per-session notice while acrylic is off', () => {
    const guard = new AcrylicGuardState();
    for (let i = 0; i < WARMUP_SAMPLES + 1; i += 1) guard.observe(20, false);

    // 亚克力关闭时提示无意义, 但判定本身不丢失
    expect(guard.observe(20, false)).toBe(false);
    expect(guard.observe(20, true)).toBe(true);
  });
});

describe('acrylic guard wiring', () => {
  let stop: (() => void) | null = null;

  afterEach(() => {
    stop?.();
    stop = null;
    vi.restoreAllMocks();
    usePerformanceStore.setState({ frontend: null, frontendHistory: [] });
  });

  it('raises one persistent warning whose action turns acrylic off', () => {
    useSettingsStore.getState().update('appearance', 'acrylicBackground', true);
    const warn = vi.spyOn(notify, 'warn');
    stop = startAcrylicPerformanceGuard();

    for (let i = 0; i < SAMPLES_TO_TRIGGER; i += 1) {
      usePerformanceStore.setState({ frontend: sample(20, i) });
    }

    expect(warn).toHaveBeenCalledTimes(1);
    const opts = warn.mock.calls[0]?.[2];
    // 带操作按钮的提示必须常驻, 否则用户错过就再也不会看到
    expect(opts?.durationMs).toBe(0);
    expect(opts?.actions).toHaveLength(1);

    opts?.actions?.[0].run();

    expect(useSettingsStore.getState().settings.appearance.acrylicBackground).toBe(false);
    expect(document.documentElement.dataset.acrylic).toBeUndefined();
  });
});
