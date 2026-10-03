import { describe, expect, it } from 'vitest';
import { FrontendPerformanceCollector, percentile } from '../frontendCollector';

describe('frontend performance collector', () => {
  it('uses nearest-rank percentiles for frame timing', () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2);
    expect(percentile([4, 1, 3, 2], 0.95)).toBe(4);
  });

  it('returns an empty sample before frame data arrives', () => {
    const collector = new FrontendPerformanceCollector();
    const sample = collector.sample();

    expect(sample.fps).toBe(0);
    expect(sample.frameTimeAverageMs).toBe(0);
    expect(sample.longTasksPerSecond).toBe(0);
    expect(sample.jsHeapUsedBytes === null || typeof sample.jsHeapUsedBytes === 'number').toBe(true);
  });
});
