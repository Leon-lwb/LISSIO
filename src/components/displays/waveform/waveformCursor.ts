import type { ScopeAxisConfig } from '../../../types';
import type { SeriesSlot } from './waveformSeries';

export interface CursorDisplayOpts {
  /// 光标吸附到曲线 (cursorSnap 设置): X 跟随鼠标, Y 吸附到距光标最近的可见曲线在鼠标 X 处的插值
  snap: boolean;
  /// Ctrl/Cmd 隐藏模式: 关闭吸附, 隐藏悬停点与读数, 但保留十字线
  hidden: boolean;
}

/// 在已排序的 dataX 上对 dataY 做线性插值, 返回 xVal 处的 Y (吸附到"线"而非采样点)
/// 边界外夹逼到端点; 任一端点为 NaN 返回 NaN; 用于光标 Y 吸附与读数取值
export function interpYAtX(
  dataX: ArrayLike<number | null | undefined> | undefined,
  dataY: ArrayLike<number | null | undefined> | undefined,
  xVal: number
): number {
  if (!dataX || !dataY || dataX.length === 0) return NaN;
  const n = dataX.length;
  // null/undefined 视为 NaN (uPlot data 可能含空值)
  const num = (v: number | null | undefined): number => (v ?? NaN);
  if (n === 1) return num(dataY[0]);
  if (xVal <= num(dataX[0])) return num(dataY[0]);
  if (xVal >= num(dataX[n - 1])) return num(dataY[n - 1]);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (num(dataX[mid]) <= xVal) lo = mid; else hi = mid;
  }
  const x0 = num(dataX[lo]), x1 = num(dataX[hi]);
  const y0 = num(dataY[lo]), y1 = num(dataY[hi]);
  if (isNaN(y0) || isNaN(y1)) return NaN;
  if (x1 === x0) return y0;
  const t = (xVal - x0) / (x1 - x0);
  return y0 + (y1 - y0) * t;
}

/// 在可见 slot 中找出"鼠标 X 处插值曲线"像素 Y 距 mouseTopPx 最近的一条
/// 返回 slots 下标; 无可见 slot 或插值全部 NaN 时返回 -1
/// 所有 series 共用同一 y scale (sharedY=真实值, 否则=div), 像素距离比较两种模式都成立
/// 供光标 Y 吸附 (cursor.move) 与读数换算 (setCursor) 共用, 保证选中通道一致
export function pickNearestVisibleSlot(
  slots: SeriesSlot[],
  cfg: ScopeAxisConfig,
  dataX: ArrayLike<number | null | undefined> | undefined,
  data: (ArrayLike<number | null | undefined> | undefined)[],
  xVal: number,
  mouseTopPx: number,
  valToPos: (yVal: number) => number
): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < slots.length; i++) {
    if (!(cfg.channels[slots[i].cfgIdx]?.show ?? true)) continue;
    const y = interpYAtX(dataX, data[i + 1], xVal);
    if (isNaN(y)) continue;
    const dist = Math.abs(valToPos(y) - mouseTopPx);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

// ---- uPlot 初始化 ----
