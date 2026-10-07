import { describe, expect, it } from 'vitest';
import { GAUGE_MARGIN, GAUGE_MAX_BOX_HEIGHT, GAUGE_MAX_RADIUS, gaugeGeometry, gaugeNaturalHeight } from '../geometry';
import { drawGauge } from '../draw';

/// 记录型 2D 上下文 — 只记录本模块用到的调用, 用于断言几何与"绝不画椭圆"
function recordingCtx() {
  const arcs: { x: number; y: number; r: number; start: number; end: number }[] = [];
  const calls = { ellipse: 0 };
  const ctx = {
    arcs,
    calls,
    lineCap: 'butt',
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    fill: () => undefined,
    fillText: () => undefined,
    arc(x: number, y: number, r: number, start: number, end: number) {
      arcs.push({ x, y, r, start, end });
    },
    ellipse: () => { calls.ellipse += 1; },
  };
  return ctx as unknown as CanvasRenderingContext2D & typeof ctx;
}

const options = (width: number, height: number) => ({
  width,
  height,
  value: 25,
  range: { min: 0, max: 100 },
  majorTicks: 5,
  precision: 0,
  palette: { track: '#a', progress: '#b', text: '#c', needle: '#d', hub: '#e' },
});

const BOXES: [number, number][] = [
  [160, 90], [184, 92], [600, 92], [184, 400], [400, 400], [161, 128],
];

describe('gaugeGeometry — 正圆 + 较短边等比缩放', () => {
  it('半径只由较短边决定, 另一维变大只增加留白', () => {
    // 高 92 / 宽 184: 高度是限幅边 (h-2m=76 < w/2-m=84)
    const heightBound = gaugeGeometry(184, 92)!;
    expect(heightBound.radius).toBeCloseTo(76, 6);
    // 变宽 (较长边) → 半径不变, 只留白
    expect(gaugeGeometry(600, 92)!.radius).toBeCloseTo(heightBound.radius, 6);
    // 宽 200 / 高 400: 宽度是限幅边 → 更高也不变
    const widthBound = gaugeGeometry(200, 400)!;
    expect(widthBound.radius).toBeCloseTo(92, 6);
    expect(gaugeGeometry(200, 800)!.radius).toBeCloseTo(widthBound.radius, 6);
    // 两维同比翻倍 → 半径成比例增长 (外缘余量是绝对像素, 故比严格 2× 多 2×余量;
    // 取一对未触上限的盒子)
    const small = gaugeGeometry(120, 60)!;
    expect(gaugeGeometry(240, 120)!.radius)
      .toBeCloseTo(small.radius * 2 + 2 * GAUGE_MARGIN, 6);
  });

  it('半圆恒在盒内, 且垂直居中', () => {
    for (const [w, h] of BOXES) {
      const g = gaugeGeometry(w, h)!;
      const reach = g.lineWidth / 2;
      expect(g.cx - g.radius - reach).toBeGreaterThanOrEqual(0);
      expect(g.cx + g.radius + reach).toBeLessThanOrEqual(w);
      expect(g.cy - g.radius - reach).toBeGreaterThanOrEqual(0);
      expect(g.cy + reach).toBeLessThanOrEqual(h);
      expect(g.cy - g.radius / 2).toBeCloseTo(h / 2, 6);
    }
  });

  it('刻度/线宽/字号随半径同比缩放', () => {
    const small = gaugeGeometry(184, 92)!;
    const big = gaugeGeometry(230, 115)!;
    const factor = big.radius / small.radius;
    expect(factor).toBeGreaterThan(1);
    expect(big.lineWidth / small.lineWidth).toBeCloseTo(factor, 6);
    expect(big.fontSize / small.fontSize).toBeCloseTo(factor, 6);
    expect((big.radius - big.tickOuter) / (small.radius - small.tickOuter)).toBeCloseTo(factor, 6);
  });

  it('半径封顶 — 控件再大也不无限变大, 只留白居中', () => {
    const huge = gaugeGeometry(2000, 2000)!;
    expect(huge.radius).toBe(GAUGE_MAX_RADIUS);
    expect(huge.cx).toBe(1000);                       // 仍水平居中
    expect(huge.cy - huge.radius / 2).toBeCloseTo(1000, 6); // 仍垂直居中
    // 未到上限前保持等比
    expect(gaugeGeometry(184, 92)!.radius).toBeLessThan(GAUGE_MAX_RADIUS);
  });

  it('天然高度按宽度推导并封顶', () => {
    expect(gaugeNaturalHeight(0)).toBe(90);
    expect(gaugeNaturalHeight(184)).toBe(92);
    expect(gaugeNaturalHeight(600)).toBe(GAUGE_MAX_BOX_HEIGHT);
    expect(gaugeNaturalHeight(2000)).toBe(GAUGE_MAX_BOX_HEIGHT);
  });

  it('盒子放不下时不画退化图形', () => {
    expect(gaugeGeometry(0, 90)).toBeNull();
    expect(gaugeGeometry(184, 10)).toBeNull();
    expect(gaugeGeometry(600, 20)).toBeNull();
  });
});

describe('drawGauge — 位图几何随支取盒重算', () => {
  it('背景弧与进度弧共用同一半径 (不出现椭圆/拉伸)', () => {
    const ctx = recordingCtx();
    const geo = drawGauge(ctx, options(184, 92))!;
    expect(ctx.calls.ellipse).toBe(0);
    const gauges = ctx.arcs.filter((a) => a.r === geo.radius);
    expect(gauges.length).toBeGreaterThanOrEqual(2);
    for (const arc of gauges) {
      expect(arc.x).toBeCloseTo(geo.cx, 6);
      expect(arc.y).toBeCloseTo(geo.cy, 6);
    }
    // 中心圆是唯一另一个同心圆
    expect(ctx.arcs.every((a) => a.x === geo.cx && a.y === geo.cy)).toBe(true);
  });

  it('控件变宽不变高时图形尺寸不变, 较短边变大才变大', () => {
    const wide = recordingCtx();
    const narrow = recordingCtx();
    const taller = recordingCtx();
    const a = drawGauge(narrow, options(184, 92))!;
    const b = drawGauge(wide, options(600, 92))!;
    const c = drawGauge(taller, options(184, 220))!;
    expect(b.radius).toBeCloseTo(a.radius, 6);
    expect(b.cx).toBeCloseTo(300, 6);          // 仍水平居中
    expect(a.radius).toBeCloseTo(76, 6);       // 高度限幅
    expect(c.radius).toBeCloseTo(84, 6);       // 长高到宽度限幅为止
    expect(c.radius).toBeGreaterThan(a.radius);
  });

  it('绘制范围不越出支取盒', () => {
    for (const [w, h] of BOXES) {
      const ctx = recordingCtx();
      const geo = drawGauge(ctx, options(w, h))!;
      const reach = geo.lineWidth / 2;
      expect(geo.cx - geo.radius - reach).toBeGreaterThanOrEqual(0);
      expect(geo.cx + geo.radius + reach).toBeLessThanOrEqual(w);
      expect(geo.cy - geo.radius - reach).toBeGreaterThanOrEqual(0);
      expect(geo.cy + reach).toBeLessThanOrEqual(h);
    }
  });

  it('盒子过小则不绘制', () => {
    const ctx = recordingCtx();
    expect(drawGauge(ctx, options(600, 12))).toBeNull();
    expect(ctx.arcs).toHaveLength(0);
  });
});
