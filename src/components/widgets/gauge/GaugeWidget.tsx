import { memo, useEffect, useRef, useState } from 'react';
import type { WidgetConfig } from '../../../types';
import { useNumericInput } from '../../../lib/hooks/useNumericPort';
import { useAutoRange } from '../../../lib/hooks/useAutoRange';
import { formatTick } from '../../../lib/utils/valueRange';
import { NumericPortStatus } from '../shared/NumericPortStatus';
import { gaugeNaturalHeight } from './geometry';
import { drawGauge, type GaugePalette } from './draw';

interface GaugeProps {
  widget: Extract<WidgetConfig, { kind: 'Gauge' }>;
}

/// 仪表盘控件 — 半圆指针 + 弧形进度 + 主刻度, 显示单通道实时值
/// 数据源: value 输入边 (后端图输出);
/// 量程: 手动 (params.range.min/max) 或滑动窗口自适应 (useAutoRange)。
///
/// 尺寸: 支取盒宽度决定天然高度 (半圆天然 2:1), 用户拖出的宽高比只改变留白 ——
/// 半径始终取较短边, 位图随支取盒同步重算, 绝不横向拉伸 (codeberg: 仪表盘变形)。
export const Gauge = memo(function Gauge({ widget }: GaugeProps) {
  const { id, range: rangeConfig, unit } = widget.params;
  const input = useNumericInput(id, 'value');
  const range = useAutoRange(id, input, rangeConfig);
  const value = input.latest?.value ?? range.min;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // 支取盒尺寸 (CSS px) — ResizeObserver 驱动; 位图尺寸只在它变化时重分配
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    // rAF 延迟 setState: 避免 RO 回调内同步改布局触发 "ResizeObserver loop" 告警
    let raf: number | null = null;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (raf !== null) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = null;
        const next = { w: Math.floor(r.width), h: Math.floor(r.height) };
        setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
      });
    });
    ro.observe(box);
    return () => {
      ro.disconnect();
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  // 后备存储只在尺寸变化时重分配 (写 canvas.width 会清空位图)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
  }, [size]);

  // 绘制 — 数值/量程/尺寸任一变化都重绘; 每次重设变换 (位图重分配会清掉它)
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const palette: GaugePalette = {
      track: cssVar('--color-border') || '#3c3c3c',
      progress: cssVar('--color-blue') || '#75beff',
      text: cssVar('--color-text-secondary') || '#858585',
      needle: cssVar('--color-red') || '#f48771',
      hub: cssVar('--color-text-primary') || '#cccccc',
    };
    drawGauge(ctx, {
      width: size.w,
      height: size.h,
      value,
      range,
      majorTicks: rangeConfig.majorTicks,
      precision: rangeConfig.precision,
      palette,
    });
  }, [size, value, range, rangeConfig.majorTicks, rangeConfig.precision]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-1">
      {/* 半圆天然 2:1: 盒子宽度决定天然高度 (半径封顶后一并封顶); 用户拖出其他宽高比时只留白不拉伸 */}
      <div
        ref={boxRef}
        className="relative w-full flex-1"
        style={{ minHeight: gaugeNaturalHeight(size.w) }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      </div>
      <div className="font-mono text-lg font-semibold text-text-bright text-center">
        {input.latest ? formatTick(value, rangeConfig.precision, range, rangeConfig.majorTicks) : '—'}
        {unit && <span className="ml-1 text-[10px] text-text-secondary font-normal">{unit}</span>}
      </div>
      <NumericPortStatus state={input} />
    </div>
  );
});
