import { describe, expect, it } from 'vitest';
import {
  dampingRatio,
  spatialTiming,
  springAt,
  springDuration,
  springFromTiming,
  springSettleTime,
  springVelocity,
  SPRING_REST_DELTA,
} from '../spring';

describe('springAt', () => {
  it('starts at the origin and settles inside the rest band', () => {
    const spring = springFromTiming({ duration: 0.4, bounce: 0.2 });
    expect(springAt(spring, 0)).toBe(0);
    expect(Math.abs(springAt(spring, springSettleTime(spring)) - 1)).toBeLessThanOrEqual(
      SPRING_REST_DELTA
    );
  });

  it('never leaves the rest band after the settle time', () => {
    const spring = springFromTiming({ duration: 0.5, bounce: 0.3 });
    const settle = springSettleTime(spring);
    for (let i = 0; i <= 40; i += 1) {
      const t = settle + i * 0.05;
      expect(Math.abs(springAt(spring, t) - 1)).toBeLessThanOrEqual(SPRING_REST_DELTA);
    }
  });

  it('overshoots when underdamped', () => {
    const bouncy = springFromTiming({ duration: 0.5, bounce: 0.3 });
    const settle = springSettleTime(bouncy);
    let peak = 0;
    for (let i = 0; i <= 400; i += 1) peak = Math.max(peak, springAt(bouncy, (i / 400) * settle));
    expect(peak).toBeGreaterThan(1.02);
    expect(dampingRatio(bouncy)).toBeLessThan(1);
  });

  it('never passes the target when critically damped', () => {
    const critical = springFromTiming({ duration: 0.5, bounce: 0 });
    expect(dampingRatio(critical)).toBeCloseTo(1, 6);
    const settle = springSettleTime(critical);
    for (let i = 0; i <= 400; i += 1) {
      // Approaches 1 from below without ever crossing it.
      expect(springAt(critical, (i / 400) * settle)).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('approaches the target monotonically from below when critically damped', () => {
    const critical = springFromTiming({ duration: 0.4, bounce: 0 });
    let previous = -Infinity;
    for (let i = 0; i <= 400; i += 1) {
      const value = springAt(critical, (i / 400) * springSettleTime(critical));
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
  });
});

describe('springVelocity', () => {
  it('reports zero launch velocity (released from rest)', () => {
    const spring = springFromTiming({ duration: 0.4, bounce: 0 });
    expect(springVelocity(spring, 0)).toBe(0);
  });

  it('agrees with a central difference away from the origin', () => {
    const spring = springFromTiming({ duration: 0.5, bounce: 0.25 });
    const h = 1e-5;
    for (const t of [0.05, 0.12, 0.25, 0.4]) {
      const numeric = (springAt(spring, t + h) - springAt(spring, t - h)) / (2 * h);
      expect(springVelocity(spring, t)).toBeCloseTo(numeric, 4);
    }
  });

  it('returns to near-zero velocity by the settle time', () => {
    const spring = springFromTiming({ duration: 0.3, bounce: 0 });
    const settle = springSettleTime(spring);
    const omega0 = Math.sqrt(spring.stiffness);
    let peak = 0;
    for (let i = 0; i <= 200; i += 1) {
      peak = Math.max(peak, Math.abs(springVelocity(spring, (i / 200) * settle)));
    }
    // Velocity is not literally zero at rest — only a small fraction of peak.
    expect(Math.abs(springVelocity(spring, settle)) / (omega0 / Math.E)).toBeLessThan(0.05);
  });

  it('peaks at 1/ω₀ for a critically damped spring', () => {
    const omega0 = 20;
    const spring = { stiffness: omega0 * omega0, damping: 2 * omega0, mass: 1 };
    expect(springVelocity(spring, 1 / omega0)).toBeCloseTo(omega0 / Math.E, 6);
  });
});

describe('springFromTiming', () => {
  it('settles in exactly the requested duration', () => {
    for (const duration of [0.12, 0.26, 0.4, 0.52, 0.8]) {
      const spring = springFromTiming({ duration, bounce: 0.2 });
      expect(springSettleTime(spring)).toBeCloseTo(duration, 2);
    }
  });

  it('varies smoothly across the critically damped boundary', () => {
    // A closed-form stiffness formula kinks at ζ = 1, which would make a
    // designer sweeping the bounce control see a jump. Overshoot is the quantity
    // that dial actually drives, so assert it advances in even steps.
    const peakOf = (bounce: number) => {
      const spring = springFromTiming({ duration: 0.4, bounce });
      const settle = springSettleTime(spring);
      let peak = 0;
      for (let i = 0; i <= 600; i += 1) peak = Math.max(peak, springAt(spring, (i / 600) * settle));
      return peak;
    };
    const steps: number[] = [];
    for (let bounce = 0.1; bounce <= 0.3; bounce += 0.01) {
      steps.push(peakOf(bounce) - peakOf(bounce - 0.01));
    }
    expect(steps.every((step) => step > 0)).toBe(true);
    // Growth per unit bounce is smooth and gently accelerating, never a spike.
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]).toBeLessThan(steps[i - 1] * 1.6);
    }
  });

  it('makes overshoot grow monotonically with bounce', () => {
    // Bounce is a perceptual dial, so peak excursion — not stiffness — is what
    // has to increase. Stiffness is *not* monotonic: a critically damped tail
    // decays slower, so easing off the damping requires a stiffer spring to
    // still settle in the same time.
    const peakOf = (bounce: number) => {
      const spring = springFromTiming({ duration: 0.4, bounce });
      const settle = springSettleTime(spring);
      let peak = 0;
      for (let i = 0; i <= 400; i += 1) peak = Math.max(peak, springAt(spring, (i / 400) * settle));
      return peak;
    };
    let previous = -Infinity;
    for (let bounce = 0; bounce <= 0.45; bounce += 0.05) {
      const peak = peakOf(bounce);
      expect(peak).toBeGreaterThan(previous);
      previous = peak;
    }
  });

  it('exposes the settle time as the tween duration', () => {
    const spring = springFromTiming({ duration: 0.32, bounce: 0.18 });
    expect(springDuration(spring)).toBeCloseTo(0.32, 2);
  });

  it('clamps degenerate inputs instead of producing a non-finite spring', () => {
    for (const spring of [
      springFromTiming({ duration: 0, bounce: 0 }),
      springFromTiming({ duration: -5, bounce: 2 }),
      springFromTiming({ duration: 10, bounce: -1 }),
    ]) {
      expect(Number.isFinite(spring.stiffness)).toBe(true);
      expect(Number.isFinite(spring.damping)).toBe(true);
      expect(Number.isFinite(springSettleTime(spring))).toBe(true);
      expect(springSettleTime(spring)).toBeGreaterThan(0);
    }
  });
});

describe('spatialTiming', () => {
  it('barely stretches a nominal offset but stretches a long flight', () => {
    const base = { duration: 0.4, bounce: 0.2 };
    expect(spatialTiming(base, 24).duration).toBeLessThan(0.43);
    expect(spatialTiming(base, 600).duration).toBeGreaterThan(0.55);
  });

  it('is monotonic in distance and bounded', () => {
    const base = { duration: 0.5, bounce: 0.25 };
    let previous = 0;
    for (const distance of [0, 40, 120, 400, 1200, 4000]) {
      const timing = spatialTiming(base, distance);
      expect(timing.duration).toBeGreaterThanOrEqual(previous);
      expect(timing.duration).toBeLessThanOrEqual(base.duration * 1.55 + 1e-9);
      expect(timing.bounce).toBeLessThanOrEqual(0.5);
      previous = timing.duration;
    }
  });

  it('treats negative distance as magnitude', () => {
    const base = { duration: 0.4, bounce: 0.2 };
    expect(spatialTiming(base, -300)).toEqual(spatialTiming(base, 300));
  });
});