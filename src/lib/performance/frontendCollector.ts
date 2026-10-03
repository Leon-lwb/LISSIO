/// Frontend renderer performance collector.
///
/// The monitor is intentionally self-contained: it observes frame timing, long
/// tasks, and Chromium's optional JS heap counters without touching product
/// data paths. Unsupported browser capabilities are returned as `null`.

import type { FrontendPerformanceSnapshot } from '../../types';

interface JsHeap {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

type PerformanceWithMemory = Performance & { memory?: JsHeap };

const MAX_FRAME_SAMPLES = 240;

export function percentile(values: readonly number[], percent: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percent) - 1));
  return sorted[rank] ?? 0;
}

export function readJsHeap(): Pick<
  FrontendPerformanceSnapshot,
  'jsHeapUsedBytes' | 'jsHeapLimitBytes'
> {
  const memory = (performance as PerformanceWithMemory).memory;
  return {
    jsHeapUsedBytes: memory?.usedJSHeapSize ?? null,
    jsHeapLimitBytes: memory?.jsHeapSizeLimit ?? null,
  };
}

export class FrontendPerformanceCollector {
  private frameTimes: number[] = [];
  private longTaskDurations: number[] = [];
  private lastFrameAt: number | null = null;
  private animationFrame: number | null = null;
  private observer: PerformanceObserver | null = null;
  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameAt = null;

    if (typeof requestAnimationFrame === 'function') {
      const tick = (now: number) => {
        if (!this.running) return;
        if (this.lastFrameAt !== null) {
          const delta = now - this.lastFrameAt;
          if (delta > 0 && delta < 1_000) {
            this.frameTimes.push(delta);
            if (this.frameTimes.length > MAX_FRAME_SAMPLES) this.frameTimes.shift();
          }
        }
        this.lastFrameAt = now;
        this.animationFrame = requestAnimationFrame(tick);
      };
      this.animationFrame = requestAnimationFrame(tick);
    }

    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration <= 0) continue;
            this.longTaskDurations.push(entry.duration);
            if (this.longTaskDurations.length > MAX_FRAME_SAMPLES) {
              this.longTaskDurations.shift();
            }
          }
        });
        observer.observe({ type: 'longtask', buffered: true });
        this.observer = observer;
      } catch {
        this.observer = null;
      }
    }
  }

  stop(): void {
    this.running = false;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.observer?.disconnect();
    this.observer = null;
  }

  sample(): FrontendPerformanceSnapshot {
    const frames = this.frameTimes.splice(0);
    const longTasks = this.longTaskDurations.splice(0);
    const average = frames.length === 0
      ? 0
      : frames.reduce((total, value) => total + value, 0) / frames.length;
    return {
      sampledAtMs: Date.now(),
      fps: average > 0 ? 1_000 / average : 0,
      frameTimeAverageMs: average,
      frameTimeP95Ms: percentile(frames, 0.95),
      longTasksPerSecond: longTasks.length,
      longestTaskMs: longTasks.length === 0 ? 0 : Math.max(...longTasks),
      ...readJsHeap(),
      monitorRpcLatencyMs: null,
    };
  }
}
