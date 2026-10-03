/// Unified frontend/backend performance telemetry lifecycle.

import { api } from '../tauri/tauri';
import { usePerformanceStore } from '../../store/performanceStore';
import { FrontendPerformanceCollector } from './frontendCollector';

const SAMPLE_INTERVAL_MS = 1_000;

let timer: ReturnType<typeof setInterval> | null = null;
let collector: FrontendPerformanceCollector | null = null;

export async function samplePerformanceOnce(): Promise<void> {
  const store = usePerformanceStore.getState();
  if (store.paused) return;

  const frontendStarted = performance.now();
  const frontend = collector?.sample() ?? null;
  try {
    const backend = await api.getBackendPerformance();
    const latency = performance.now() - frontendStarted;
    if (frontend) {
      store.pushFrontend({ ...frontend, monitorRpcLatencyMs: latency });
    }
    store.pushBackend(backend);
    store.setError(null);
  } catch (error) {
    if (frontend) {
      store.pushFrontend({
        ...frontend,
        monitorRpcLatencyMs: performance.now() - frontendStarted,
      });
    }
    store.setError(error instanceof Error ? error.message : String(error));
  }
}

export function startPerformanceTelemetry(): () => void {
  if (timer !== null) return stopPerformanceTelemetry;
  collector = new FrontendPerformanceCollector();
  collector.start();
  void samplePerformanceOnce();
  timer = setInterval(() => void samplePerformanceOnce(), SAMPLE_INTERVAL_MS);
  return stopPerformanceTelemetry;
}

export function stopPerformanceTelemetry(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  collector?.stop();
  collector = null;
}
