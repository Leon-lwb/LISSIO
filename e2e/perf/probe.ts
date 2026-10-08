/**
 * Frontend performance probe — measures from **outside the browser** without changing a single
 * line of product code.
 *
 * Why inject externally: real performance defects are almost always "one harmless extra line"
 * (`canvas.width = w` reallocating the backing store, `setAttribute` refreshing attributes every
 * frame, `getBoundingClientRect` reading layout every frame). Putting counters into product
 * components would leave those calls with a permanent resident cost and would also tempt people
 * to optimize "the probe's numbers" instead of the real cost. By patching prototypes in
 * `addInitScript`, the probe exists only for the measurement session and vanishes with the page
 * once measurement ends.
 *
 * Measurements fall into two classes whose reliability differs greatly, and gates must treat
 * them differently:
 *
 *   **Deterministic counts** (integers, machine-independent):
 *     backing-store reallocation, `setAttribute`, `getBoundingClientRect`,
 *     `getComputedStyle`, React commit count.
 *     These directly encode the **causes** of jank; the same code counts the same on any
 *     machine, so they can serve as hard gates — failing precisely on a regression and being
 *     able to point at "which allocation went up".
 *
 *   **Timing metrics** (floats, strongly load-dependent):
 *     fps, frame-time percentiles, long tasks, JS heap.
 *     Headless Chromium has no real vsync, frame intervals are driven by the BeginFrame
 *     scheduler, and the load of a shared CI runner directly rewrites these numbers. Absolute
 *     values **must not** be gates, or all that gets trained is the reflex of "it went red,
 *     rerun it". They only serve trend records and loose warnings.
 *
 * Known limitations (these must stay written here so they are not misread):
 *   - This probe patches only **main-thread prototypes**, so it quantifies CPU cost on the main
 *     thread side.
 *   - Two classes of cost are entirely outside its view, and no conclusion may be inferred from
 *     this probe's numbers about them:
 *       1. `backdrop-filter` runs in the **compositor**. It is invisible to every counter here,
 *          so the "acrylic on vs off" difference is not "the cost of blur", only noise after grid
 *          quantization (measured at 2.27e-13 ms). The frosting cost is instead governed by a
 *          structural budget, see docs/performance/frontend-render-budget.md.
 *       2. **Layout reflows triggered by CSS transitions** go through no JS at all and happen in
 *          the browser's C++. `transition: flex-grow` measures 0 here while the cost is a reflow
 *          of the whole panel subtree on every frame. Such defects are caught statically by
 *          `pnpm check:motion`.
 */

/** The shape the probe exposes on the page side. Everything on `window.__lissioPerf`. */
export interface PerfProbe {
  /** The various deterministic counters. */
  counters: PerfCounters;
  /** Frame-interval samples (ms); only the most recent `FRAME_WINDOW` are kept. */
  frameIntervals: number[];
  /** Long-task durations (ms). */
  longTasks: number[];
  /** `tag[attribute]` -> count. The only basis for locating "who is refreshing attributes". */
  attributeBreakdown: Record<string, number>;
  /** Clear samples and counts so scenarios do not contaminate each other. */
  reset(): void;
  /** Freeze measurement: nothing accumulates afterwards (avoiding the read of the snapshot itself affecting the data). */
  stop(): void;
}

export interface PerfCounters {
  /**
   * Number of assignments to `canvas.width` / `canvas.height` — backing-store reallocations.
   * Writing these two properties on a canvas also clears the entire bitmap, so this number is
   * the most direct measure of "how many frames needlessly repainted the base image".
   */
  canvasBackingStoreRealloc: number;
  /** Number of `Element.setAttribute` calls (a source of per-frame attribute-refresh cost in SVG/React). */
  setAttribute: number;
  /** Number of `getBoundingClientRect` calls — reads that force synchronous layout. */
  getBoundingClientRect: number;
  /** Number of `getComputedStyle` calls — these also force style recalculation. */
  getComputedStyle: number;
  /** Number of rAF callback invocations. */
  animationFrame: number;
  /** Number of observed long tasks (main thread blocked > 50ms). */
  longTask: number;
}

/** A complete page-side snapshot of the counters. */
export interface PerfSample extends PerfCounters {
  /** Average fps computed from frame intervals (0 means the window was not visible, so nothing was sampled). */
  fps: number;
  /** Frame-interval p95 (ms). */
  frameTimeP95Ms: number;
  /** Longest single frame interval (ms) — the best expression of "a hitch". */
  frameTimeMaxMs: number;
  /** Total long-task time (ms) and the longest single task (ms). */
  longTaskTotalMs: number;
  longestTaskMs: number;
  /** JS heap (MB); null when `performance.memory` is unavailable. */
  jsHeapMb: number | null;
  /** Number of frames the sample covers, used to judge whether this measurement is statistically meaningful. */
  frames: number;
  /** The top attribute writes, truncated in descending order of count. */
  topAttributes: { key: string; count: number }[];
}

/**
 * Inject the probe. Must be called before `page.goto` so the prototypes are patched before the
 * application starts.
 *
 * Counts are maintained by the closure injected through `addInitScript`, so the page itself
 * cannot reach them and cannot misuse them; product code such as `canvas.width = x` stays
 * completely unchanged.
 */
export const PERF_PROBE_INIT = `
(() => {
  const FRAME_WINDOW = 4096;
  const counters = {
    canvasBackingStoreRealloc: 0,
    setAttribute: 0,
    getBoundingClientRect: 0,
    getComputedStyle: 0,
    animationFrame: 0,
    longTask: 0,
  };
  const frameIntervals = [];
  const longTasks = [];
  const attributeBreakdown = {};
  let stopped = false;
  let last = null;

  // —— Backing-store reallocation ——
  // width/height are accessors on HTMLCanvasElement.prototype, so they must be wrapped again with
  // defineProperty; assigning directly would break the native accessors.
  const proto = HTMLCanvasElement.prototype;
  for (const dim of ['width', 'height']) {
    const desc = Object.getOwnPropertyDescriptor(proto, dim);
    if (!desc || !desc.set || !desc.get) continue;
    Object.defineProperty(proto, dim, {
      configurable: true,
      enumerable: desc.enumerable,
      get() { return desc.get.call(this); },
      set(value) {
        // Only a real size change counts as one reallocation. Rewriting the same value also clears
        // the backing store, so it cannot be deduplicated by "equal value" — the write itself is
        // the cost and must be counted as it happens.
        counters.canvasBackingStoreRealloc += 1;
        desc.set.call(this, value);
      },
    });
  }

  // —— Attribute writes (a source of per-frame SVG attribute-refresh cost) ——
  // Also grouped by "tag[attribute]". With only a total, the gate could say "5472 times" and
  // nobody would know where to fix it; with the breakdown it points directly at which component
  // is refreshing which attribute.
  const rawSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, ...rest) {
    counters.setAttribute += 1;
    try {
      const key = this.tagName + '[' + name + ']';
      attributeBreakdown[key] = (attributeBreakdown[key] || 0) + 1;
    } catch {
      /* Host objects without a tagName are extremely rare; the breakdown is auxiliary, and a failure here must not affect counting */
    }
    return rawSetAttribute.call(this, name, ...rest);
  };

  // —— Reads that force layout / style recalculation ——
  // Count only calls on elements; patching the prototype covers getBoundingClientRect / getClientRects.
  for (const name of ['getBoundingClientRect', 'getClientRects']) {
    const raw = Element.prototype[name];
    if (typeof raw !== 'function') continue;
    Element.prototype[name] = function (...args) {
      counters.getBoundingClientRect += 1;
      return raw.apply(this, args);
    };
  }
  const rawGetComputedStyle = window.getComputedStyle;
  window.getComputedStyle = function (...args) {
    counters.getComputedStyle += 1;
    return rawGetComputedStyle.apply(this, args);
  };

  // —— Frame intervals ——
  // Sampling rides on rAF rather than a self-built loop: rAF is in phase with the browser's frame
  // production, so the interval is the real frame distance.
  const rawRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return rawRaf(function (ts) {
      counters.animationFrame += 1;
      if (!stopped) {
        if (last !== null) {
          const delta = ts - last;
          // Filter out long gaps caused by tab switches / breakpoints; they are not rendering cost.
          if (delta > 0 && delta < 1000) {
            frameIntervals.push(delta);
            if (frameIntervals.length > FRAME_WINDOW) frameIntervals.shift();
          }
        }
        last = ts;
      }
      return cb(ts);
    });
  };

  // —— Long tasks ——
  if (typeof PerformanceObserver === 'function') {
    try {
      new PerformanceObserver((list) => {
        if (stopped) return;
        for (const entry of list.getEntries()) {
          if (entry.duration <= 0) continue;
          counters.longTask += 1;
          longTasks.push(entry.duration);
          if (longTasks.length > FRAME_WINDOW) longTasks.shift();
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      /* Browsers without longtask support: one metric fewer, which must not fail the whole measurement */
    }
  }

  window.__lissioPerf = {
    counters,
    frameIntervals,
    longTasks,
    attributeBreakdown,
    reset() {
      for (const key of Object.keys(counters)) counters[key] = 0;
      frameIntervals.length = 0;
      longTasks.length = 0;
      for (const key of Object.keys(attributeBreakdown)) delete attributeBreakdown[key];
      last = null;
      stopped = false;
    },
    stop() { stopped = true; },
  };
})();
`;

/** Collapse the probe's raw data in-page into one comparable sample. */
function collectSample(): PerfSample {
  const probe = (window as unknown as { __lissioPerf?: PerfProbe }).__lissioPerf;
  if (!probe) throw new Error('the perf probe is not injected: the probe must be installed before goto');
  probe.stop();
  const frames = probe.frameIntervals.slice().sort((a, b) => a - b);
  const count = frames.length;
  const p95 = count > 0 ? frames[Math.min(count - 1, Math.ceil(count * 0.95) - 1)] : 0;
  const average = count > 0 ? frames.reduce((t, v) => t + v, 0) / count : 0;
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return {
    ...probe.counters,
    fps: average > 0 ? 1000 / average : 0,
    frameTimeP95Ms: p95,
    frameTimeMaxMs: count > 0 ? frames[count - 1] : 0,
    longTaskTotalMs: probe.longTasks.reduce((t, v) => t + v, 0),
    longestTaskMs: probe.longTasks.length > 0 ? Math.max(...probe.longTasks) : 0,
    jsHeapMb: mem ? mem.usedJSHeapSize / 1048576 : null,
    frames: count,
    // Keep only the top 8 entries: the breakdown is meant to point the way, not to export a
    // complete list; the full set would make the artifact swell until it cannot be diffed.
    topAttributes: Object.entries(probe.attributeBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([key, count]) => ({ key, count })),
  };
}

/** Reset the probe in the page to start measuring a new scenario. */
export async function resetProbe(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __lissioPerf?: PerfProbe }).__lissioPerf?.reset();
  });
}

/**
 * Read one sample.
 *
 * `stop()` is called first: taking a snapshot walks the arrays, and if rAF were still advancing at
 * that moment, the sampled frame count would drift with the read duration, the same scenario would
 * produce different `frames` on two runs, and the gate would lose its meaning.
 */
export async function readProbe(page: import('@playwright/test').Page): Promise<PerfSample> {
  return page.evaluate(collectSample);
}