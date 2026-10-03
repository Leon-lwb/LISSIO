import { beforeEach, describe, expect, it } from 'vitest';
import { usePerformanceStore } from '../performanceStore';
import type { BackendPerformanceSnapshot } from '../../types/generated/BackendPerformanceSnapshot';
import type { FrontendPerformanceSnapshot } from '../../types';

function frontend(sampledAtMs: number): FrontendPerformanceSnapshot {
  return {
    sampledAtMs,
    fps: 60,
    frameTimeAverageMs: 16,
    frameTimeP95Ms: 18,
    longTasksPerSecond: 0,
    longestTaskMs: 0,
    jsHeapUsedBytes: 1024,
    jsHeapLimitBytes: 4096,
    monitorRpcLatencyMs: 2,
  };
}

function backend(sampledAtMs: number): BackendPerformanceSnapshot {
  return {
    sampledAtMs,
    process: { cpuPercent: 1, memoryBytes: 1024, uptimeMs: 10, threadCount: 2 },
    rpc: {
      calls: 1,
      errors: 0,
      averageLatencyMs: 1,
      p50LatencyMs: 1,
      p95LatencyMs: 2,
      maxLatencyMs: 2,
    },
    websocket: {
      activeConnections: 1,
      sentFrames: 1,
      sentBytes: 10,
      droppedFrames: 0,
      droppedBytes: 0,
    },
    pipeline: {
      queuedBatches: 0,
      queuedFrames: 0,
      queuedBytes: 0,
      queueWaitMaxMs: 0,
      dispatchWaitMaxMs: 0,
      evalServiceMaxMs: 0,
      completedFrames: 1,
      completedBatches: 1,
      droppedFrames: 0,
      activeTopics: 1,
      publishedSamples: 1,
      previewSkipped: 0,
      ingressDropped: 0,
    },
  };
}

describe('performance store', () => {
  beforeEach(() => usePerformanceStore.getState().clearHistory());

  it('keeps bounded frontend and backend history', () => {
    const store = usePerformanceStore.getState();
    for (let i = 0; i < 305; i += 1) {
      store.pushFrontend(frontend(i));
      store.pushBackend(backend(i));
    }

    const state = usePerformanceStore.getState();
    expect(state.frontendHistory).toHaveLength(300);
    expect(state.backendHistory).toHaveLength(300);
    expect(state.frontendHistory[0]?.sampledAtMs).toBe(5);
    expect(state.backendHistory[state.backendHistory.length - 1]?.sampledAtMs).toBe(304);
  });
});
