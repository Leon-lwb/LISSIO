import { useLayoutEffect } from 'react';
import uPlot from 'uplot';
import { getEffectiveChannel, getEffectiveRender, formatVPerDiv } from '../../../types';
import { timeBaseToWindowSec, VERTICAL_DIVS } from '../../../lib/utils/scopeUtils';
import {
  CHANNEL_COLORS, DERIVED_COLORS, TEXT_COLOR, GRID_COLOR, TICK_COLOR, getContainerSize,
} from './waveformConstants';
import { getThemeColor, formatTimeMs, formatYValue } from './wavechartFormatters';
import { buildLinePath, buildSeriesPoints } from './waveformRender';
import type { ScopeAxisConfig } from '../../../types';
import type { SeriesSlot } from './waveformSeries';
import { interpYAtX, pickNearestVisibleSlot, type CursorDisplayOpts } from './waveformCursor';
import { maybeShowInteractHint } from './waveformInteractionHint';

export function useUplotInit(
  containerRef: React.RefObject<HTMLDivElement | null>,
  plotRef: React.MutableRefObject<uPlot | null>,
  axisConfigRef: React.MutableRefObject<ScopeAxisConfig>,
  seriesSlotsRef: React.MutableRefObject<SeriesSlot[]>,
  getDisplayData: () => [Float64Array, ...Float32Array[]],
  setCursorReadout: React.Dispatch<React.SetStateAction<{
    leftPx: number; topPx: number; xSec: number; yDiv: number;
    yVal: number; yUnit: string;
    channels: { label: string; val: number; color: string; isDerived: boolean }[];
  } | null>>,
  setSelectedRange: React.Dispatch<React.SetStateAction<{ startSec: number; endSec: number } | null>>,
  seriesSignature: string,
  themeId: string,
  cursorOptsRef: React.MutableRefObject<CursorDisplayOpts>,
  renderSignature: string,
) {
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let plot: uPlot | null = null;
    let resizeRaf: number | null = null;
    let lastW = 0, lastH = 0;

    const createSeries = (): uPlot.Series[] => {
      const cfg0 = axisConfigRef.current;
      const yUnit = cfg0.yUnit ?? '';
      const slots = seriesSlotsRef.current;
      const textColor = getThemeColor('--color-waveform-text', TEXT_COLOR);
      const series: uPlot.Series[] = [{
        label: 't', stroke: textColor,
        value: (_u, v) => (v == null ? '--' : formatTimeMs(v * 1000)),
      }];
      for (const slot of slots) {
        const chCfg = getEffectiveChannel(cfg0, slot.cfgIdx);
        const vPerDiv = chCfg.vPerDiv;
        const pos = chCfg.position;
        const show = cfg0.channels[slot.cfgIdx]?.show ?? true;
        const color = slot.isDerived
          ? DERIVED_COLORS[slot.colorIdx % DERIVED_COLORS.length]
          : CHANNEL_COLORS[slot.colorIdx % CHANNEL_COLORS.length];
        const render = getEffectiveRender(cfg0, slot.cfgIdx);
        series.push({
          label: `${slot.label} ${formatVPerDiv(vPerDiv, yUnit)}`,
          stroke: color,
          width: 1.5,
          // 峰谷包络会在同一 CSS 像素内保留多个真实时间点；整像素吸附会把
          // 它们压到相同 X/Y 坐标，连续斜线因此看起来像阶梯。
          pxAlign: 0,
          paths: buildLinePath(render),
          points: buildSeriesPoints(render, color),
          value: (_u, v) => {
            if (v == null) return '--';
            const c = axisConfigRef.current;
            const real = c.sharedY ? v : v * vPerDiv + pos;
            return formatYValue(real, c.yUnit ?? '');
          },
          show,
        });
      }
      return series;
    };

    const createOptions = (w: number, h: number): uPlot.Options => {
      const cfg = axisConfigRef.current;
      const gridStroke = cfg.grid ? getThemeColor('--color-waveform-grid', GRID_COLOR) : 'transparent';
      const textColor = getThemeColor('--color-waveform-text', TEXT_COLOR);
      const tickColor = getThemeColor('--color-waveform-tick', TICK_COLOR);
      return {
        width: w, height: h, series: createSeries(),
        axes: [
          {
            stroke: textColor, grid: { stroke: gridStroke, width: 1 },
            ticks: { stroke: tickColor }, size: 32, gap: 4,
            label: '',
            labelSize: 20, labelFont: '11px sans-serif',
            values: (_self, ticks) => {
              const c = axisConfigRef.current;
              const winSec = timeBaseToWindowSec(c.timeBase);
              if (winSec >= 1) return ticks.map((v) => v.toFixed(2) + 's');
              if (winSec >= 0.001) return ticks.map((v) => (v * 1000).toFixed(1) + 'ms');
              return ticks.map((v) => (v * 1e6).toFixed(0) + 'µs');
            },
          },
          {
            stroke: textColor, grid: { stroke: gridStroke, width: 1 },
            ticks: { stroke: tickColor }, size: 50, gap: 4,
            label: '',
            labelSize: 16, labelFont: '11px sans-serif',
            values: (_self, ticks) => {
              const c = axisConfigRef.current;
              if (c.sharedY) {
                const unit = c.yUnit ?? '';
                return ticks.map((v) => formatYValue(v, unit));
              }
              return ticks.map((v) => v.toFixed(0));
            },
          },
        ],
        legend: { show: false },
        cursor: {
          points: { size: 4 },
          // 左键拖动 = 框选 (uPlot 内建); 平移走右键 / Shift+左键 (usePanDrag)
          drag: { x: true, y: false },
          // 光标吸附到"线": X 始终跟随鼠标 (不吸附), Y 吸附到距光标最近的可见曲线在鼠标 X 处的插值
          // snap 关闭或 Ctrl 隐藏时: X/Y 均自由跟随鼠标 (仍显示十字线)
          move: (u: uPlot, mouseLeft: number, mouseTop: number): [number, number] => {
            const o = cursorOptsRef.current;
            if (!o.snap || o.hidden || mouseLeft < 0) return [mouseLeft, mouseTop];
            const cfg = axisConfigRef.current;
            const slots = seriesSlotsRef.current;
            const xVal = u.posToVal(mouseLeft, 'x');
            const visSlot = pickNearestVisibleSlot(
              slots, cfg, u.data[0], u.data, xVal, mouseTop, (v) => u.valToPos(v, 'y')
            );
            if (visSlot < 0) return [mouseLeft, mouseTop];
            const interpY = interpYAtX(u.data[0], u.data[visSlot + 1], xVal);
            if (isNaN(interpY)) return [mouseLeft, mouseTop];
            return [mouseLeft, u.valToPos(interpY, 'y')];
          },
        },
        scales: {
          x: {
            time: false,
            range: () => {
              const c = axisConfigRef.current;
              // hPosition=0 即实时跟随 (end=0); 运行中 hPosition>0 时偏移回看历史, 数据继续刷新
              const end = -c.hPosition;
              const win = timeBaseToWindowSec(c.timeBase);
              return [end - win, end];
            },
          },
          y: {
            range: () => {
              const c = axisConfigRef.current;
              if (c.sharedY) {
                const ch0 = getEffectiveChannel(c, 0);
                return [
                  ch0.position - (ch0.vPerDiv * VERTICAL_DIVS) / 2,
                  ch0.position + (ch0.vPerDiv * VERTICAL_DIVS) / 2,
                ];
              }
              return [-VERTICAL_DIVS / 2, VERTICAL_DIVS / 2];
            },
          },
        },
        hooks: {
          setCursor: [
            (u: uPlot) => {
              const idx = u.cursor.idx;
              const left = u.cursor.left;
              const top = u.cursor.top;
              if (idx == null || left == null || top == null || idx < 0 || left < 0 || top < 0) {
                setCursorReadout(null);
                return;
              }
              const c = axisConfigRef.current;
              // 吸附模式下读数取曲线插值; 非吸附取最近采样点
              const snapping = cursorOptsRef.current.snap && !cursorOptsRef.current.hidden;
              const xSec = u.posToVal(left, 'x');
              const yPixelVal = u.posToVal(top, 'y');
              const bbox = (u as unknown as { bbox?: { left: number; top: number } }).bbox;
              // uPlot bbox 是设备像素 (内部已乘 devicePixelRatio), 需换回 CSS 像素
              const dpr = window.devicePixelRatio || 1;
              const plotLeft = (bbox?.left ?? 0) / dpr;
              const plotTop = (bbox?.top ?? 0) / dpr;
              const canvasLeft = left + plotLeft;
              const canvasTop = top + plotTop;
              const slots = seriesSlotsRef.current;
              // 吸附模式: 换算通道与 move 吸附的最近通道一致 (top 已是吸附后的像素 Y, 复算结果相同)
              // 非吸附: 仍用第一条可见通道近似换算自由光标的读数
              let slotIdx: number;
              if (snapping) {
                slotIdx = pickNearestVisibleSlot(
                  slots, c, u.data[0], u.data, xSec, top, (v) => u.valToPos(v, 'y')
                );
                if (slotIdx < 0) slotIdx = 0;
              } else {
                const firstVisibleIdx = slots.findIndex((s) => c.channels[s.cfgIdx]?.show ?? true);
                slotIdx = firstVisibleIdx >= 0 ? firstVisibleIdx : 0;
              }
              const selSlot = slots[slotIdx];
              const chCfg = selSlot
                ? getEffectiveChannel(c, selSlot.cfgIdx)
                : { vPerDiv: 1, position: 0 };
              const yVal = c.sharedY ? yPixelVal : yPixelVal * chCfg.vPerDiv + chCfg.position;
              const channels: { label: string; val: number; color: string; isDerived: boolean }[] = [];
              for (let i = 0; i < slots.length; i++) {
                const slot = slots[i];
                const ownCh = c.channels[slot.cfgIdx];
                if (ownCh && !ownCh.show) continue;
                const divVal = snapping
                  ? interpYAtX(u.data[0], u.data[i + 1], xSec)
                  : u.data[i + 1]?.[idx];
                if (divVal == null || isNaN(divVal)) continue;
                const eff = getEffectiveChannel(c, slot.cfgIdx);
                const realVal = c.sharedY ? divVal : divVal * eff.vPerDiv + eff.position;
                channels.push({
                  label: slot.label,
                  val: realVal,
                  color: slot.isDerived
                    ? DERIVED_COLORS[slot.colorIdx % DERIVED_COLORS.length]
                    : CHANNEL_COLORS[slot.colorIdx % CHANNEL_COLORS.length],
                  isDerived: slot.isDerived,
                });
              }
              setCursorReadout({
                leftPx: canvasLeft,
                topPx: canvasTop,
                xSec,
                yDiv: yPixelVal,
                yVal,
                yUnit: c.yUnit ?? '',
                channels,
              });
            },
          ],
          setSelect: [
            (u: uPlot) => {
              const { left, width, show } = u.select;
              if (!show || width == null || width <= 0) {
                setSelectedRange(null);
                return;
              }
              // 首次框选时提示平移方式 (会话级一次)
              maybeShowInteractHint();
              const s1 = u.posToVal(left, 'x');
              const s2 = u.posToVal(left + width, 'x');
              setSelectedRange({
                startSec: Math.min(s1, s2),
                endSec: Math.max(s1, s2),
              });
            },
          ],
        },
      };
    };

    const createPlot = () => {
      const { w, h } = getContainerSize(container);
      plot = new uPlot(
        createOptions(w, h),
        getDisplayData(),
        container
      );
      plotRef.current = plot;
      lastW = w; lastH = h;
    };

    // 整体 rAF 延迟: RO 回调内同步创建/setSize uPlot 会读写布局,
    // 易触发 "ResizeObserver loop completed with undelivered notifications"
    const resize = () => {
      const { w, h } = getContainerSize(container);
      if (w === lastW && h === lastH) return;
      lastW = w; lastH = h;
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        if (!plot) createPlot();
        else plot.setSize({ width: w, height: h });
      });
    };

    createPlot();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    window.addEventListener('resize', resize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', resize);
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      plot?.destroy();
      plotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesSignature, themeId, renderSignature]);
}

// ---- 滚轮缩放 ----
