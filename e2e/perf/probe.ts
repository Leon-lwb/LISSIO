/**
 * 前端性能探针 —— 从**浏览器外部**计量, 不改一行业务代码。
 *
 * 为什么要外部注入: 真正的性能缺陷几乎都是"多写了一行无害的代码"
 * (`canvas.width = w` 重分配后备存储、`setAttribute` 逐帧刷属性、
 * `getBoundingClientRect` 逐帧读布局)。把计数器塞进业务组件等于给这些调用
 * 留一个永久的常驻开销, 也会诱使人去优化"探针数字"而不是真实成本。
 * 在 `addInitScript` 里打原型, 探针只存在于测量会话中, 测完即随页面消失。
 *
 * 计量分两类, 可靠性差别很大, 门禁必须区别对待:
 *
 *   **确定性计数** (整数, 与机器无关):
 *     后备存储重分配、`setAttribute`、`getBoundingClientRect`、
 *     `getComputedStyle`、React commit 次数。
 *     这些直接编码了卡顿的**成因**, 同一份代码在任何机器上数出来都一样,
 *     所以可以作为硬门禁 —— 回归时精确失败, 且能指着说"哪一次分配多了"。
 *
 *   **时序指标** (浮点, 与负载强相关):
 *     fps、帧时间分位、长任务、JS 堆。
 *     无头 Chromium 没有真实 vsync, 帧间隔由 BeginFrame 调度器驱动,
 *     共享 CI runner 的负载会直接改写这些数字。绝对值**不能**作为门禁,
 *     否则只会训练出"红了就重跑"的肌肉记忆。它们只做趋势记录与宽松告警。
 *
 * 已知局限 (必须写在这里, 不要让它被误读):
 *   - 本探针只打**主线程原型**, 因此它量化的是主线程侧的 CPU 成本。
 *   - 两类成本完全在它的视野之外, 且都不许从本探针的数字推断结论:
 *       1. `backdrop-filter` 在**合成器**里做。它对这里的每个计数器都是不可见的,
 *          所以"亚克力开 vs 关"的差值不是"模糊的代价", 只是栅格量化后的噪声
 *          (实测 2.27e-13 ms)。磨砂成本改由结构性预算管, 见
 *          docs/performance/frontend-render-budget.md。
 *       2. **CSS 过渡触发的布局重排**不经过任何 JS, 在浏览器 C++ 里发生。
 *          `transition: flex-grow` 在这里量出来是 0, 代价却是每帧一次整棵面板
 *          子树的重排。这类缺陷由 `pnpm check:motion` 静态拦。
 */

/** 探针在页面侧暴露的形状。`window.__lissioPerf` 上的全部内容。 */
export interface PerfProbe {
  /** 各类确定性计数器。 */
  counters: PerfCounters;
  /** 帧间隔采样 (ms), 只保留最近 `FRAME_WINDOW` 个。 */
  frameIntervals: number[];
  /** 长任务时长 (ms)。 */
  longTasks: number[];
  /** `标签[属性]` -> 次数。定位"谁在刷属性"的唯一依据。 */
  attributeBreakdown: Record<string, number>;
  /** 清空采样与计数, 让每个场景互不污染。 */
  reset(): void;
  /** 冻结测量: 之后不再累积 (避免读取快照本身影响数据)。 */
  stop(): void;
}

export interface PerfCounters {
  /**
   * `canvas.width` / `canvas.height` 的赋值次数 —— 后备存储重分配。
   * 给 canvas 写这两个属性会连带清空整块位图, 因此这个数字是"有多少帧
   * 白白重画了一遍底图"的最直接度量。
   */
  canvasBackingStoreRealloc: number;
  /** `Element.setAttribute` 调用次数 (SVG/React 逐帧刷属性的开销来源)。 */
  setAttribute: number;
  /** `getBoundingClientRect` 调用次数 —— 强制同步布局的读操作。 */
  getBoundingClientRect: number;
  /** `getComputedStyle` 调用次数 —— 同样会强制样式重算。 */
  getComputedStyle: number;
  /** rAF 回调执行次数。 */
  animationFrame: number;
  /** 被观测到的长任务个数 (main thread 被占住 > 50ms)。 */
  longTask: number;
}

/** 计数器在页面侧的完整快照。 */
export interface PerfSample extends PerfCounters {
  /** 由帧间隔算出的平均 fps (0 表示窗口不可见, 没有采样)。 */
  fps: number;
  /** 帧间隔 p95 (ms)。 */
  frameTimeP95Ms: number;
  /** 单帧最长间隔 (ms) —— 最能体现"顿一下"。 */
  frameTimeMaxMs: number;
  /** 长任务总时长 (ms) 与最长单次 (ms)。 */
  longTaskTotalMs: number;
  longestTaskMs: number;
  /** JS 堆 (MB); 无 `performance.memory` 时为 null。 */
  jsHeapMb: number | null;
  /** 采样覆盖的帧数, 用于判断这次测量是否有统计意义。 */
  frames: number;
  /** 属性写入最多的若干项, 已按次数降序截断。 */
  topAttributes: { key: string; count: number }[];
}

/**
 * 注入探针。必须在 `page.goto` 之前调用, 这样才能赶在应用启动前挂上原型。
 *
 * 计数用 `addInitScript` 注入的闭包维护, 因此页面自己拿不到、也不会误用;
 * 业务代码里 `canvas.width = x` 之类的写法完全不变。
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

  // —— 后备存储重分配 ——
  // width/height 是 HTMLCanvasElement.prototype 上的访问器, 必须用
  // defineProperty 重新包一层; 直接赋值会破坏原生访问器。
  const proto = HTMLCanvasElement.prototype;
  for (const dim of ['width', 'height']) {
    const desc = Object.getOwnPropertyDescriptor(proto, dim);
    if (!desc || !desc.set || !desc.get) continue;
    Object.defineProperty(proto, dim, {
      configurable: true,
      enumerable: desc.enumerable,
      get() { return desc.get.call(this); },
      set(value) {
        // 只有真的改变尺寸才算一次重分配。同值重复写同样会清空后备存储,
        // 所以不能靠"值相等"去重 —— 写入本身就是代价, 必须照实计。
        counters.canvasBackingStoreRealloc += 1;
        desc.set.call(this, value);
      },
    });
  }

  // —— 属性写入 (逐帧刷 SVG 属性的开销来源) ——
  // 额外按 "标签[属性]" 归类。只记总数的话, 门禁只能说"5472 次", 没人知道该去
  // 改哪里; 归类之后它会直接指出是哪个组件在刷哪个属性。
  const rawSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, ...rest) {
    counters.setAttribute += 1;
    try {
      const key = this.tagName + '[' + name + ']';
      attributeBreakdown[key] = (attributeBreakdown[key] || 0) + 1;
    } catch {
      /* 极规���的宿主对象没有 tagName; 归类是辅助信息, 失败不该影响计数 */
    }
    return rawSetAttribute.call(this, name, ...rest);
  };

  // —— 强制布局 / 样式重算的读操作 ——
  // 只统计元素上的调用; 走原型即可覆盖 getBoundingClientRect / getClientRects。
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

  // —— 帧间隔 ——
  // 采样挂在 rAF 上而不是自建循环: rAF 与浏览器出帧同相位, 间隔即真实帧距。
  const rawRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return rawRaf(function (ts) {
      counters.animationFrame += 1;
      if (!stopped) {
        if (last !== null) {
          const delta = ts - last;
          // 过滤切标签页/断点造成的长空档, 它们不是渲染成本。
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

  // —— 长任务 ——
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
      /* 不支持 longtask 的浏览器: 少一个指标, 不该让整次测量失败 */
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

/** 页面内把探针原始数据收敛成一份可比较的样本。 */
function collectSample(): PerfSample {
  const probe = (window as unknown as { __lissioPerf?: PerfProbe }).__lissioPerf;
  if (!probe) throw new Error('perf probe 未注入: 探针必须在 goto 之前安装');
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
    // 只留前 8 项: 归类的目的是指路, 不是导出完整清单; 全量会让产物
    // 迅速膨胀到没法 diff。
    topAttributes: Object.entries(probe.attributeBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([key, count]) => ({ key, count })),
  };
}

/** 在页面里重置探针, 开始一个新场景的计量。 */
export async function resetProbe(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __lissioPerf?: PerfProbe }).__lissioPerf?.reset();
  });
}

/**
 * 读取一份样本。
 *
 * 读之前先 `stop()`: 取快照本身要遍历数组, 若此时 rAF 还在推进, 采到的
 * 帧数就会随读取耗时漂移, 同一个场景两次跑出不同的 `frames`, 门禁失去意义。
 */
export async function readProbe(page: import('@playwright/test').Page): Promise<PerfSample> {
  return page.evaluate(collectSample);
}