import { describe, expect, it } from 'vitest';
import { MOMENTUM_FLOOR_PX_S, planRelease } from '../release';
import {
  springAt,
  springAtWithVelocity,
  springFromTiming,
  springNoOvershootVelocity,
  springSettleTime,
} from '../spring';

// 断言的是方向、相对距离与"是否发生位移"这类空间关系; 时长只断言为正且有界,
// 不锁死具体毫秒数 —— 毫秒数会随调参变化。

const CRITICAL = springFromTiming({ duration: 0.4, bounce: 0 });

function peakOf(spring: Parameters<typeof springAt>[0], velocity: number): number {
  let peak = 0;
  for (let i = 0; i <= 800; i += 1) {
    peak = Math.max(peak, springAtWithVelocity(spring, (i / 800) * springSettleTime(spring), velocity));
  }
  return peak;
}

describe('springAtWithVelocity', () => {
  it('零初速度时与 springAt 逐点相等', () => {
    for (const bounce of [0, 0.06, 0.18, 0.25]) {
      const spring = springFromTiming({ duration: 0.35, bounce });
      for (let i = 0; i <= 200; i += 1) {
        const t = (i / 200) * springSettleTime(spring) * 1.2;
        expect(springAtWithVelocity(spring, t, 0)).toBeCloseTo(springAt(spring, t), 12);
      }
    }
  });

  it('起步速度就是给定的初速度, 而不是从静止重新起步', () => {
    const h = 1e-6;
    for (const velocity of [0, 3, 9, 17]) {
      const numeric =
        (springAtWithVelocity(CRITICAL, h, velocity) - springAtWithVelocity(CRITICAL, 0, velocity)) / h;
      expect(numeric).toBeCloseTo(velocity, 3);
    }
  });

  it('初速度越大越早抵达, 同样的时长走得更远', () => {
    const at = (velocity: number, t: number) => springAtWithVelocity(CRITICAL, t, velocity);
    for (const t of [0.02, 0.05, 0.1]) {
      expect(at(12, t)).toBeGreaterThan(at(6, t));
      expect(at(6, t)).toBeGreaterThan(at(0, t));
    }
  });

  it('钳在无过冲边界以内时不越过落点 — 离场一旦荡回来就读成渲染故障', () => {
    const bound = springNoOvershootVelocity(CRITICAL);
    expect(peakOf(CRITICAL, bound * 0.9)).toBeLessThanOrEqual(1);
  });

  it('超过边界就会过冲, 说明这个边界确实有意义', () => {
    const bound = springNoOvershootVelocity(CRITICAL);
    expect(peakOf(CRITICAL, bound * 2)).toBeGreaterThan(1);
  });

  it('非法初速度退化成从静止起步', () => {
    for (const velocity of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(springAtWithVelocity(CRITICAL, 0.05, velocity)).toBeCloseTo(
        springAtWithVelocity(CRITICAL, 0.05, 0),
        12
      );
    }
  });
});

describe('planRelease', () => {
  it('放稳了 (低于动量下限时) 只有原地放大淡出, 不产生位移', () => {
    const plan = planRelease(0, 0);
    expect(plan.dx).toBe(0);
    expect(plan.dy).toBe(0);
    expect(plan.initialVelocity).toBe(0);
    expect(plan.durationMs).toBeGreaterThan(0);
  });

  it('下限时与下限时以下表现一致 — 阈值本身就是分界', () => {
    const justUnder = planRelease(MOMENTUM_FLOOR_PX_S - 1, 0);
    expect(justUnder.dx).toBe(0);
    expect(planRelease(MOMENTUM_FLOOR_PX_S * 0.9, 0).dx).toBe(0);
  });

  it('前冲方向就是松手速度的方向', () => {
    for (const [vx, vy] of [
      [2000, 0],
      [-1500, 0],
      [0, 1800],
      [0, -2200],
      [1200, 1200],
    ]) {
      const plan = planRelease(vx, vy);
      expect(Math.sign(plan.dx)).toBe(Math.sign(vx));
      expect(Math.sign(plan.dy)).toBe(Math.sign(vy));
    }
  });

  it('甩得越狠滑得越远', () => {
    const light = planRelease(MOMENTUM_FLOOR_PX_S * 1.2, 0);
    const heavy = planRelease(MOMENTUM_FLOOR_PX_S * 6, 0);
    expect(Math.hypot(heavy.dx, heavy.dy)).toBeGreaterThan(Math.hypot(light.dx, light.dy));
  });

  it('航程有界 — 荒唐的甩动速度也不能把幽灵甩出屏幕', () => {
    const absurd = planRelease(1e6, 1e6);
    expect(Math.hypot(absurd.dx, absurd.dy)).toBeLessThan(200);
    expect(Number.isFinite(absurd.durationMs)).toBe(true);
  });

  it('初速度落在无过冲边界以内, 所以幽灵只会滑向落点而不会荡回来', () => {
    for (const speed of [MOMENTUM_FLOOR_PX_S, 1500, 2500, 5000, 20000]) {
      const plan = planRelease(speed, 0);
      expect(plan.initialVelocity).toBeGreaterThan(0);
      const spring = springFromTiming({ duration: 0.3, bounce: 0 });
      expect(plan.initialVelocity).toBeLessThanOrEqual(springNoOvershootVelocity(spring));
    }
  });

  it('释放时长始终为正且有界, 组件与清除定时器共用这一个数', () => {
    for (const speed of [0, 800, 3000, 50000]) {
      const plan = planRelease(speed, 0);
      expect(plan.durationMs).toBeGreaterThan(0);
      expect(plan.durationMs).toBeLessThan(1000);
    }
  });

  it('非法速度退化成放稳了, 不产生 NaN 位移', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const plan = planRelease(bad, bad);
      expect(Number.isFinite(plan.dx)).toBe(true);
      expect(Number.isFinite(plan.dy)).toBe(true);
      expect(Number.isFinite(plan.durationMs)).toBe(true);
    }
  });
});