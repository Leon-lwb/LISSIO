//! 仪表盘绘制 — 与 React 解耦, 便于用记录型 ctx 断言"只有一个半径"。
//!
//! 半圆范围: 180° (左端 = min) ~ 360° (右端 = max), 经过顶部 (canvas Y 轴向下)。

import { formatTick, tickValues, type DisplayRange } from '../../../lib/utils/valueRange';
import { gaugeGeometry, type GaugeGeometry } from './geometry';

/// 主题色 — 由调用方从 CSS 变量取, 保持本模块无 DOM 依赖
export interface GaugePalette {
  track: string;
  progress: string;
  text: string;
  needle: string;
  hub: string;
}

export interface GaugeDrawOptions {
  width: number;
  height: number;
  value: number;
  range: DisplayRange;
  majorTicks: number;
  precision: 'auto' | number;
  palette: GaugePalette;
}

const START_ANGLE = Math.PI;
const END_ANGLE = Math.PI * 2;
const TOTAL_ANGLE = END_ANGLE - START_ANGLE;

/// 半圆仪表: 背景弧 + 进度弧 + 主刻度/标签 + 指针 + 中心圆。
/// 返回本次使用的几何; null = 支取盒太小, 未绘制。
export function drawGauge(ctx: CanvasRenderingContext2D, o: GaugeDrawOptions): GaugeGeometry | null {
  const geo = gaugeGeometry(o.width, o.height);
  if (!geo) return null;
  const { cx, cy, radius } = geo;
  const { min, max } = o.range;

  // 背景弧
  ctx.lineCap = 'round';
  ctx.strokeStyle = o.palette.track;
  ctx.lineWidth = geo.lineWidth;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, START_ANGLE, END_ANGLE);
  ctx.stroke();

  // 进度弧
  const ratio = Math.max(0, Math.min(1, (o.value - min) / (max - min || 1)));
  const valueAngle = START_ANGLE + ratio * TOTAL_ANGLE;
  ctx.strokeStyle = o.palette.progress;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, START_ANGLE, valueAngle);
  ctx.stroke();

  // 主刻度 + 标签
  const ticks = tickValues(o.range, o.majorTicks);
  ctx.strokeStyle = o.palette.text;
  ctx.fillStyle = o.palette.text;
  ctx.lineWidth = 1;
  ctx.font = `${geo.fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ticks.forEach((tick, i) => {
    const a = START_ANGLE + (i / (ticks.length - 1 || 1)) * TOTAL_ANGLE;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(cx + cos * geo.tickInner, cy + sin * geo.tickInner);
    ctx.lineTo(cx + cos * geo.tickOuter, cy + sin * geo.tickOuter);
    ctx.stroke();
    ctx.fillText(
      formatTick(tick, o.precision, o.range, o.majorTicks),
      cx + cos * geo.labelRadius,
      cy + sin * geo.labelRadius + geo.labelDrop,
    );
  });

  // 指针
  ctx.strokeStyle = o.palette.needle;
  ctx.lineWidth = geo.needleWidth;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(valueAngle) * geo.needleLength, cy + Math.sin(valueAngle) * geo.needleLength);
  ctx.stroke();

  // 中心圆
  ctx.fillStyle = o.palette.hub;
  ctx.beginPath();
  ctx.arc(cx, cy, geo.hubRadius, 0, Math.PI * 2);
  ctx.fill();

  return geo;
}
