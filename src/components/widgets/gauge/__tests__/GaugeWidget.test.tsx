import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { NumericPortState } from '../../../../lib/data/numericTypes';
import type { WidgetConfig } from '../../../../types';

/// 数据面不在本用例范围内 — 固定成"有值"状态
vi.mock('../../../../lib/hooks/useNumericPort', () => ({
  useNumericInput: (): NumericPortState => ({
    source: { nodeId: 'g', handle: 'value', domain: 'time' },
    connected: true,
    status: 'live',
    latest: { seq: 1, ts: 0, value: 42 },
    history: [],
    previewSkipped: 0,
    retentionEvicted: 0,
    ingressDropped: 0,
    error: null,
  }),
}));
vi.mock('../../../../lib/hooks/useAutoRange', () => ({
  useAutoRange: () => ({ min: 0, max: 100 }),
}));

import { Gauge } from '../GaugeWidget';

interface RecordedArc { x: number; y: number; r: number }
interface RecordingCtx {
  arcs: RecordedArc[];
  lineCap: string; strokeStyle: string; fillStyle: string; lineWidth: number; font: string; textAlign: string;
  beginPath: () => void; moveTo: () => void; lineTo: () => void;
  stroke: () => void; fill: () => void; fillText: () => void;
  setTransform: () => void; clearRect: () => void;
  arc: (x: number, y: number, r: number) => void;
}

/// 记录型 2D 上下文 — 抓 arc() 调用, 断言位图几何随支取盒重算
function recordingCtx(): RecordingCtx {
  const arcs: RecordedArc[] = [];
  return {
    arcs,
    lineCap: 'butt', strokeStyle: '', fillStyle: '', lineWidth: 1, font: '', textAlign: 'left',
    beginPath: () => undefined, moveTo: () => undefined, lineTo: () => undefined,
    stroke: () => undefined, fill: () => undefined, fillText: () => undefined,
    setTransform: () => undefined, clearRect: () => undefined,
    arc: (x, y, r) => { arcs.push({ x, y, r }); },
  };
}

/// 可控 ResizeObserver — setup.ts 的全局桩不触发回调, 这里按用例投递尺寸
let deliver: ((size: { width: number; height: number }) => void) | null = null;
let ctx: RecordingCtx;

const widget = {
  kind: 'Gauge',
  params: {
    id: 'g', label: 'G', unit: 'V',
    range: { mode: 'manual', min: 0, max: 100, windowSec: 5, majorTicks: 5 },
    precision: 1,
  },
} as unknown as Extract<WidgetConfig, { kind: 'Gauge' }>;

beforeEach(() => {
  deliver = null;
  ctx = recordingCtx();
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: ResizeObserverCallback) {
      deliver = (size) => cb([{ contentRect: size } as ResizeObserverEntry], this);
    }
    observe() { return undefined; }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
  });
  // rAF 同步执行 — 组件的 rAF 延迟 setState 在用例里立即落地
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/// 投递一次支取盒尺寸; 清空记录, 只保留这次重绘的 3 个 arc (背景弧/进度弧/中心圆)
const resize = (width: number, height: number) => {
  ctx.arcs.length = 0;
  act(() => { deliver?.({ width, height }); });
};
const canvasOf = (container: HTMLElement) => container.querySelector('canvas')!;
const boxOf = (container: HTMLElement) => canvasOf(container).parentElement!;

describe('Gauge 尺寸自适应', () => {
  it('位图随支取盒重算 — 改宽后不再沿用旧位图 (旧位图会被 CSS 拉伸成椭圆)', () => {
    const { container } = render(<Gauge widget={widget} />);
    resize(184, 92);
    expect(canvasOf(container).width).toBe(184);
    expect(canvasOf(container).height).toBe(92);
    expect(ctx.arcs[0].r).toBeCloseTo(76, 6);
    expect(ctx.arcs[0].x).toBeCloseTo(92, 6);
    // 背景弧与进度弧同半径 → 只有一个圆半径, 不存在 x/y 双半径的拉伸
    expect(ctx.arcs[1].r).toBeCloseTo(ctx.arcs[0].r, 6);

    resize(400, 92);
    expect(canvasOf(container).width).toBe(400);
    expect(canvasOf(container).height).toBe(92);
    expect(ctx.arcs[0].r).toBeCloseTo(76, 6);   // 高度仍是限幅边 → 半径不变
    expect(ctx.arcs[0].x).toBeCloseTo(200, 6);  // 圆心随宽度居中
  });

  it('支取盒天然高度为半圆宽高比 (宽/2), 有下限也有上限', () => {
    const { container } = render(<Gauge widget={widget} />);
    resize(184, 92);
    expect(boxOf(container).style.minHeight).toBe('92px');
    resize(240, 130);
    expect(boxOf(container).style.minHeight).toBe('120px');
    resize(600, 300);
    expect(boxOf(container).style.minHeight).toBe('136px');  // 半径封顶 → 高度一并封顶
    resize(120, 60);
    expect(boxOf(container).style.minHeight).toBe('90px');
  });

  it('半径封顶: 超大控件不再放大, 仍居中', () => {
    const { container } = render(<Gauge widget={widget} />);
    resize(2000, 2000);
    expect(canvasOf(container).width).toBe(2000);
    expect(ctx.arcs[0].r).toBeCloseTo(120, 6);
    expect(ctx.arcs[0].x).toBeCloseTo(1000, 6);
    expect(ctx.arcs[0].y).toBeCloseTo(1060, 6);
  });

  it('随控件变大变小: 长高时半径增大, 且始终只有一个圆半径', () => {
    render(<Gauge widget={widget} />);
    resize(184, 92);
    const flat = ctx.arcs[0].r;
    resize(184, 300);
    const tall = ctx.arcs[0].r;
    expect(tall).toBeCloseTo(84, 6);
    expect(tall).toBeGreaterThan(flat);
    // 3 个 arc: 背景弧 / 进度弧 (同半径) + 中心圆 (更小)
    expect(ctx.arcs).toHaveLength(3);
    expect(ctx.arcs[1].r).toBeCloseTo(tall, 6);
    expect(ctx.arcs[2].r).toBeLessThan(tall);
    expect(new Set(ctx.arcs.map((a) => a.r)).size).toBe(2);
  });
});
