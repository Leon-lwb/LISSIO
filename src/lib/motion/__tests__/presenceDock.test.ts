import { describe, expect, it } from 'vitest';
import { dockPanelGeometry, type DockEdge } from '../presence';

const EDGES: DockEdge[] = ['left', 'right', 'bottom'];

describe('dockPanelGeometry', () => {
  it('anchors scaling to the edge the panel is docked to', () => {
    // 面板的归属只能从 transform-origin 读出来: 缩放必须朝它所属的那条边生长。
    expect(dockPanelGeometry('left').origin).toBe('left center');
    expect(dockPanelGeometry('right').origin).toBe('right center');
    expect(dockPanelGeometry('bottom').origin).toBe('center bottom');
  });

  it('starts an entrance outboard of the dock edge', () => {
    // 进场位移必须指向所属边之外, 否则面板读起来像"从窗口中间淡入"。
    const sign = (edge: DockEdge) => Math.sign(dockPanelGeometry(edge).enterFrom.x || dockPanelGeometry(edge).enterFrom.y);
    const outward: Record<DockEdge, number> = { left: -1, right: 1, bottom: 1 };
    for (const edge of EDGES) expect(sign(edge)).toBe(outward[edge]);
  });

  it('moves only along the axis the panel is docked to', () => {
    // 左右停靠只走 x, 底部停靠只走 y —— 混入另一轴会让面板从错误的方位斜切进来。
    for (const edge of ['left', 'right'] as const) {
      const { enterFrom } = dockPanelGeometry(edge);
      expect(enterFrom.x).not.toBe(0);
      expect(enterFrom.y).toBe(0);
    }
    const bottom = dockPanelGeometry('bottom').enterFrom;
    expect(bottom.x).toBe(0);
    expect(bottom.y).not.toBe(0);
  });

  it('keeps the entrance offsets the same magnitude on every edge', () => {
    // 三条边的位移必须同量, 否则同一次开合在不同边会读成不同的力度。
    const magnitudes = EDGES.map((edge) => {
      const { enterFrom } = dockPanelGeometry(edge);
      return Math.hypot(enterFrom.x, enterFrom.y);
    });
    expect(new Set(magnitudes).size).toBe(1);
  });

  it('scales a bottom panel far less than a side panel', () => {
    // 底部面板横跨整个窗口宽度, 均匀缩放会把它压窄 —— 一个只该竖向收拢的抽屉
    // 不该同时变窄。
    expect(dockPanelGeometry('bottom').enterScale).toBeGreaterThan(
      dockPanelGeometry('left').enterScale
    );
    expect(dockPanelGeometry('bottom').enterScale).toBeLessThan(1);
  });

  it('settles from slightly inset on every edge', () => {
    // 到位的面板都该略微过冲再沉降, 所以终点缩放略小于 1 而非大于 1。
    for (const edge of EDGES) {
      const { enterScale } = dockPanelGeometry(edge);
      expect(enterScale).toBeGreaterThan(0.9);
      expect(enterScale).toBeLessThanOrEqual(1);
    }
  });
});
