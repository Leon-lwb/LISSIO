import { useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { timeBaseToWindowSec, VERTICAL_DIVS } from '../../../lib/utils/scopeUtils';
import { getEffectiveChannel, TIME_BASES_SEC, V_PER_DIV } from '../../../types';
import { useSettingsStore } from '../../../store/settingsStore';
import { maybeShowInteractHint } from './waveformInteractionHint';
import { isTextEntryTarget } from '../../../lib/utils/a11y';
import type { ScopeAxisConfig } from '../../../types';

export function useWheelZoom(
  containerRef: React.RefObject<HTMLDivElement | null>,
  axisConfigRef: React.MutableRefObject<ScopeAxisConfig>,
  onConfigChange: ((next: ScopeAxisConfig) => void) | undefined,
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cfgRef = axisConfigRef;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const cfg = cfgRef.current;
      if (e.shiftKey) {
        const firstVisibleIdx = cfg.channels.findIndex((c) => c.show);
        const idx = firstVisibleIdx >= 0 ? firstVisibleIdx : 0;
        const ch = cfg.channels[idx];
        if (!ch) return;
        let vIdx = V_PER_DIV.indexOf(ch.vPerDiv);
        if (vIdx < 0) {
          let bestDiff = Infinity;
          for (let i = 0; i < V_PER_DIV.length; i++) {
            const d = Math.abs(V_PER_DIV[i] - ch.vPerDiv);
            if (d < bestDiff) { bestDiff = d; vIdx = i; }
          }
        }
        const nextV = Math.max(0, Math.min(V_PER_DIV.length - 1, vIdx + (e.deltaY > 0 ? 1 : -1)));
        if (nextV === vIdx) return;
        const newChannels = cfg.channels.slice();
        newChannels[idx] = { ...newChannels[idx], vPerDiv: V_PER_DIV[nextV] };
        onConfigChange?.({ ...cfg, channels: newChannels });
      } else {
        let tbIdx = TIME_BASES_SEC.indexOf(cfg.timeBase);
        if (tbIdx < 0) {
          let bestDiff = Infinity;
          for (let i = 0; i < TIME_BASES_SEC.length; i++) {
            const d = Math.abs(TIME_BASES_SEC[i] - cfg.timeBase);
            if (d < bestDiff) { bestDiff = d; tbIdx = i; }
          }
        }
        const nextTb = Math.max(0, Math.min(TIME_BASES_SEC.length - 1, tbIdx + (e.deltaY > 0 ? 1 : -1)));
        if (nextTb === tbIdx) return;
        onConfigChange?.({ ...cfg, timeBase: TIME_BASES_SEC[nextTb] });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [axisConfigRef, containerRef, onConfigChange]);
}

// ---- 右键 / Shift+左键 / 中键 拖拽平移 ----


export function usePanDrag(
  containerRef: React.RefObject<HTMLDivElement | null>,
  plotRef: React.MutableRefObject<uPlot | null>,
  axisConfigRef: React.MutableRefObject<ScopeAxisConfig>,
  onConfigChange: ((next: ScopeAxisConfig) => void) | undefined,
  setSelectedRange: React.Dispatch<React.SetStateAction<{ startSec: number; endSec: number } | null>>,
) {
  const panRef = useRef<{ startX: number; startY: number; startHPos: number; startPos: number; chIdx: number; dragged: boolean } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const isPanGesture = (e: MouseEvent) =>
      e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey);
    // 捕获阶段处理平移手势: stopPropagation 阻止 uPlot 的框选
    // (uPlot 在 over 元素上只认 button==0 且不检查修饰键, 不拦截则 Shift+左键会同时触发框选)
    const onMouseDown = (e: MouseEvent) => {
      if (!isPanGesture(e)) return;
      e.stopPropagation();
      e.preventDefault();
      const cfg = axisConfigRef.current;
      const firstVisible = cfg.channels.findIndex((c) => c.show);
      const chIdx = firstVisible >= 0 ? firstVisible : 0;
      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startHPos: cfg.hPosition,
        startPos: getEffectiveChannel(cfg, chIdx).position,
        chIdx,
        dragged: false,
      };
      el.style.cursor = 'grabbing';
    };
    const onMouseMove = (e: MouseEvent) => {
      const ps = panRef.current;
      if (!ps) return;
      const plot = plotRef.current;
      if (!plot) return;
      e.preventDefault();
      if (!ps.dragged) {
        // 首次真正拖动时: 清框选 + 弹交互提示 (单击不触发)
        ps.dragged = true;
        maybeShowInteractHint();
        setSelectedRange(null);
        plot.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
      }
      const cfg = axisConfigRef.current;
      const dx = e.clientX - ps.startX;
      const dy = e.clientY - ps.startY;
      const winSec = timeBaseToWindowSec(cfg.timeBase);
      const secPerPx = winSec / plot.width;
      const newHPos = ps.startHPos + dx * secPerPx;
      const effCh = getEffectiveChannel(cfg, ps.chIdx);
      const valPerPx = (effCh.vPerDiv * VERTICAL_DIVS) / plot.height;
      const newPos = ps.startPos + dy * valPerPx;
      const newChannels = cfg.channels.slice();
      if (cfg.sharedY) {
        newChannels[0] = { ...newChannels[0], position: newPos };
      } else {
        newChannels[ps.chIdx] = { ...newChannels[ps.chIdx], position: newPos };
      }
      // 「交互时自动暂停」开启时才停止刷新; 关闭时运行中也可拖动 (含垂直拖动) 不打断刷新
      const pauseOnInteract = useSettingsStore.getState().settings.editor.pauseOnInteract;
      onConfigChange?.({ ...cfg, ...(pauseOnInteract ? { running: false } : {}), hPosition: Math.max(0, newHPos), channels: newChannels });
    };
    const onMouseUp = () => {
      if (panRef.current) {
        panRef.current = null;
        el.style.cursor = '';
      }
    };
    // 屏蔽波形图上的右键菜单: preventDefault 挡原生菜单; stopPropagation 挡
    // App 根节点 onContextMenu 弹出的应用内自定义菜单 (macOS 上 contextmenu 随
    // 右键按下即触发, 无法等拖动结束再判断, 且波形图上本无右键菜单)
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener('mousedown', onMouseDown, true);
    el.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      el.removeEventListener('mousedown', onMouseDown, true);
      el.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [axisConfigRef, containerRef, onConfigChange, plotRef, setSelectedRange]);
}

// ---- Ctrl/Cmd 隐藏游标 ----

export function useCursorHide() {
  const [cursorHidden, setCursorHidden] = useState(false);
  const isMac = useMemo(
    () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform),
    []
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEntryTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey) setCursorHidden(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) setCursorHidden(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return { cursorHidden, isMac };
}

// ---- Tooltip 定位 ----

export function useTooltipPos(
  cursorReadout: { leftPx: number; topPx: number } | null,
  containerRef: React.RefObject<HTMLDivElement | null>,
  tooltipRef: React.RefObject<HTMLDivElement | null>,
) {
  const [tooltipPos, setTooltipPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!cursorReadout) {
      setTooltipPos(null);
      return;
    }
    const tooltip = tooltipRef.current;
    const container = containerRef.current;
    if (!tooltip || !container) return;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const gap = 12;
    let left = cursorReadout.leftPx + gap;
    let top = cursorReadout.topPx + gap;
    if (left + tw > cw) {
      left = cursorReadout.leftPx - gap - tw;
    }
    if (top + th > ch) {
      top = cursorReadout.topPx - gap - th;
    }
    left = Math.max(0, left);
    top = Math.max(0, top);
    setTooltipPos({ left, top });
  }, [cursorReadout, containerRef, tooltipRef]);

  return tooltipPos;
}
