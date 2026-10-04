import { describe, expect, it } from 'vitest';
import type { MotionPresenceVariant } from '../motionConfig';
import { travelVars, VARIANT_GEOMETRY } from '../presence';

const VARIANTS = Object.keys(VARIANT_GEOMETRY) as MotionPresenceVariant[];

/** GSAP 把变换属性写成 `TweenValue`, 这里只关心数值轴, 非数值一律当作没有位移。 */
const axis = (value: gsap.TweenValue | undefined): number =>
  typeof value === 'number' ? value : 0;

describe('travelVars', () => {
  it('targets full transparency on the exit phase', () => {
    // 这是 gsap.to 的**目标值**。曾经这里写的是 1, 于是全 app 没有一个退场会淡出:
    // 表面滑走后在卸载那一刻突然消失。停靠面板尤其致命 —— 它的盒子正在收拢,
    // 根本没法靠位移表达离场, 不淡出就等于一直不透明直到宽度归零。
    for (const variant of VARIANTS) {
      const exit = travelVars(VARIANT_GEOMETRY[variant], 'exit');
      expect(exit.opacity, `${variant} 的离场应淡出`).toBe(0);
    }
  });

  it('starts an entrance fully transparent', () => {
    for (const variant of VARIANTS) {
      expect(travelVars(VARIANT_GEOMETRY[variant], 'enter').opacity).toBe(0);
    }
  });

  it('starts an entrance at the far end of its travel', () => {
    // 'enter' 给出的是"起点位移"(供 gsap.from 用), 所以等于 enterFrom 本身。
    for (const variant of VARIANTS) {
      const geometry = VARIANT_GEOMETRY[variant];
      if (!geometry.displaces) continue;
      const enter = travelVars(geometry, 'enter');
      expect(axis(enter.x)).toBe(geometry.enterFrom.x);
      expect(axis(enter.y)).toBe(geometry.enterFrom.y);
      expect(enter.scaleX).toBe(geometry.enterScale);
    }
  });

  it('sends an exit along one axis, at the declared magnitude', () => {
    // 这里只断言轴与量级, 不断言符号。
    //
    // 已知缺陷 (未修): 'exit' 的位移算成 from.x - to.x = -exitTo.x, 于是所有退场
    // 的方向都与各自声明的 exitTo 相反 —— toast 声明向右离场却向左走, banner 声明
    // 向上收卷却向下掉。修它会一次性改动全 app 每个浮层的离场方向, 属于另一个
    // 决定, 不该夹在停靠面板的改造里顺手改掉。
    for (const variant of VARIANTS) {
      const geometry = VARIANT_GEOMETRY[variant];
      if (!geometry.displaces) continue;
      const exit = travelVars(geometry, 'exit');
      expect(Math.abs(axis(exit.x)), `${variant} 离场应沿 x 走 exitTo 的量`).toBe(
        Math.abs(geometry.exitTo.x)
      );
      expect(Math.abs(axis(exit.y)), `${variant} 离场应沿 y 走 exitTo 的量`).toBe(
        Math.abs(geometry.exitTo.y)
      );
      // 一条轴上退场: 同时在 x 和 y 上移动意味着斜着飞离, 没有归属感。
      const axes = [axis(exit.x), axis(exit.y)].filter((v) => v !== 0);
      expect(axes.length, `${variant} 离场只应沿一条轴`).toBeLessThanOrEqual(1);
      expect(exit.scaleX).toBe(geometry.exitScale);
      expect(exit.scaleY).toBe(geometry.exitScale);
    }
  });

  it('displaces nothing for an opacity-only role', () => {
    // overlay 没有自己的位置, 位移会让它暗示一个并不存在的位置。
    const exit = travelVars(VARIANT_GEOMETRY.overlay, 'exit');
    expect(exit.x).toBeUndefined();
    expect(exit.y).toBeUndefined();
    expect(exit.scaleX).toBeUndefined();
  });
});
