//! 仪表盘几何 — 单个半径 (绝不用椭圆双半径), 半圆按支取盒的较短边等比缩放并居中。
//!
//! 旧实现把 canvas 的 CSS 高度固定成 90px, 且只在数值/量程变化时重设位图:
//! 拖动 NodeResizer 改宽高后 CSS 会把旧位图横向拉伸成椭圆, 半径也恒为 67.5 —
//! 于是"仪表盘比例随控件比例变化"。

/// 半圆外的描边/抗锯齿余量 (CSS px)
export const GAUGE_MARGIN = 8;

/// 半径上限 — 控件再大也不让仪表盘无限变大 (超出后只留白居中)
export const GAUGE_MAX_RADIUS = 120;

/// 支取盒天然高度下限 — 内容自适应节点靠它撑出节点高度
export const GAUGE_MIN_BOX_HEIGHT = 90;

/// 天然高度上限 — 半径封顶后盒子不必再随宽度长高
export const GAUGE_MAX_BOX_HEIGHT = GAUGE_MAX_RADIUS + 2 * GAUGE_MARGIN;

/// 设计基准半径 — 旧版 90px 高画布下的实际半径, 全部比例系数以它为 1
const DESIGN_RADIUS = 67.5;

/// 半径下限 — 更小的盒子放不下刻度与指针, 直接不画
const MIN_RADIUS = 6;

/// 支取盒宽度 → 天然高度 (CSS px)。半圆天然 2:1, 宽度决定高度; 半径封顶后
/// 高度一并封顶, 免得宽控件把节点拉得过高、仪表盘却不再变大。
export function gaugeNaturalHeight(w: number): number {
  return Math.min(Math.max(GAUGE_MIN_BOX_HEIGHT, Math.round(w / 2)), GAUGE_MAX_BOX_HEIGHT);
}

/// 绘制所需的全部尺寸 (CSS px) — 由支取盒推导
export interface GaugeGeometry {
  cx: number;
  cy: number;
  radius: number;
  lineWidth: number;
  needleWidth: number;
  needleLength: number;
  hubRadius: number;
  tickInner: number;
  tickOuter: number;
  labelRadius: number;
  fontSize: number;
  labelDrop: number;
}

/// 支取盒 (w × h) → 半圆几何; 盒太小返回 null。
///
/// 半径 = min(半宽 - 余量, 高 - 2×余量, 上限) — 由较短边决定且封顶, 宽高比的变化
/// 只影响留白 (半圆始终在盒内水平/垂直居中), 不会变成椭圆。刻度内缩/线宽/字号随
/// 半径同比缩放, 放大后不会挤在圆心。
export function gaugeGeometry(w: number, h: number): GaugeGeometry | null {
  const radius = Math.min(w / 2 - GAUGE_MARGIN, h - 2 * GAUGE_MARGIN, GAUGE_MAX_RADIUS);
  if (!Number.isFinite(radius) || radius < MIN_RADIUS) return null;
  const scale = radius / DESIGN_RADIUS;
  return {
    cx: w / 2,
    // 半圆纵向只占 radius, 取其中心与盒中心重合
    cy: (h + radius) / 2,
    radius,
    lineWidth: Math.min(14, Math.max(3, 8 * scale)),
    needleWidth: Math.min(4, Math.max(1.5, 2 * scale)),
    needleLength: radius - 8 * scale,
    hubRadius: Math.min(7, Math.max(2, 4 * scale)),
    tickInner: radius - 12 * scale,
    tickOuter: radius - 4 * scale,
    labelRadius: radius - 22 * scale,
    fontSize: Math.min(14, Math.max(8, 9 * scale)),
    labelDrop: 3 * scale,
  };
}
