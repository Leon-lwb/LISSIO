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

  it('retreats toward the same edge it entered from', () => {
    // 退场方向必须与进场同向 —— 朝自己所属的边收。原地淡出没有方向, 于是收起的
    // 面板读起来是"消失", 而不是"被收进边框"。
    for (const edge of EDGES) {
      const { enterFrom, exitTo } = dockPanelGeometry(edge);
      expect(Math.sign(exitTo.x || exitTo.y), `${edge} 退场应朝所属边外侧`).toBe(
        Math.sign(enterFrom.x || enterFrom.y)
      );
    }
  });

  it('retreats along the axis it is docked to', () => {
    // 与进场同一条理由: 混入另一轴会让面板从错误的方位斜着退出去。
    for (const edge of EDGES) {
      const { exitTo } = dockPanelGeometry(edge);
      const axes = [exitTo.x, exitTo.y].filter((v) => v !== 0);
      expect(axes, `${edge} 退场只应沿一条轴`).toHaveLength(1);
    }
  });

  it('keeps the retreat offsets the same magnitude on every edge', () => {
    // 三条边同量: 否则同一次开合换个停靠边就读成不同的力度。
    const magnitudes = EDGES.map((edge) => {
      const { exitTo } = dockPanelGeometry(edge);
      return Math.hypot(exitTo.x, exitTo.y);
    });
    expect(new Set(magnitudes).size).toBe(1);
  });

  it('shrinks toward its edge on the way out', () => {
    // 终点缩放必须小于 1 —— 到位后还要继续收, 才是"退场"而不是"停住"。
    for (const edge of EDGES) {
      const { exitScale } = dockPanelGeometry(edge);
      expect(exitScale, `${edge} 退场应收缩`).toBeLessThan(1);
      expect(exitScale).toBeGreaterThan(0.8);
    }
  });

  it('shrinks a bottom panel far less than a side panel', () => {
    // 与进场同一条理由: 底部抽屉横跨整窗, 横向收窄它是错的读法。
    expect(dockPanelGeometry('bottom').exitScale).toBeGreaterThan(
      dockPanelGeometry('left').exitScale
    );
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
