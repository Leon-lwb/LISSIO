import { describe, expect, it } from 'vitest';
import { motionDuration, motionSpring, motionTiming } from '../motionConfig';
import { springToLinearEasing } from '../easingTokens';
import { springSettleTime, SPRING_REST_DELTA } from '../spring';

function parseLinear(value: string): number[] {
  const inner = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')'));
  return inner.split(',').map((stop) => Number(stop.trim()));
}

describe('springToLinearEasing', () => {
  it('emits a CSS linear() function pinned to the identity at both ends', () => {
    const easing = springToLinearEasing(motionSpring('surface', 'in'));
    expect(easing.startsWith('linear(')).toBe(true);
    const stops = parseLinear(easing);
    expect(stops[0]).toBe(0);
    expect(stops[stops.length - 1]).toBe(1);
    expect(stops.every(Number.isFinite)).toBe(true);
  });

  it('reproduces the spring response at each interior stop', () => {
    const spring = motionSpring('spatial', 'in');
    const settle = springSettleTime(spring);
    const stops = parseLinear(springToLinearEasing(spring));
    // The first and last stops are pinned to the identity on purpose (see the
    // endpoint test), so only the interior is compared against the solver.
    for (let i = 1; i < stops.length - 1; i += 1) {
      const ratio = i / (stops.length - 1);
      const expected = springAtReference(spring, ratio * settle);
      expect(stops[i]).toBeCloseTo(expected, 3);
    }
  });

  it('pins the endpoints to identity at a cost below the rest band', () => {
    const spring = motionSpring('spatial', 'in');
    const settle = springSettleTime(spring);
    const stops = parseLinear(springToLinearEasing(spring));
    const tail = springAtReference(spring, settle);
    expect(stops[0]).toBe(0);
    expect(stops[stops.length - 1]).toBe(1);
    expect(Math.abs(tail - 1)).toBeLessThanOrEqual(SPRING_REST_DELTA);
  });

  it('stays within the legal range for CSS output values', () => {
    // Overshoot above 1 is legal in linear() and is the whole point of baking a
    // spring into CSS, but runaway values would be a solver bug.
    const stops = parseLinear(springToLinearEasing(motionSpring('spatial', 'in')));
    for (const stop of stops) {
      expect(stop).toBeGreaterThanOrEqual(-0.05);
      expect(stop).toBeLessThanOrEqual(1.3);
    }
  });

  it('emits monotone output for exit springs', () => {
    const stops = parseLinear(springToLinearEasing(motionSpring('surface', 'out')));
    for (let i = 1; i < stops.length; i += 1) {
      expect(stops[i]).toBeGreaterThanOrEqual(stops[i - 1] - 1e-9);
    }
  });

  it('is stable across repeated calls (cache-safe)', () => {
    const spring = motionSpring('content', 'in');
    expect(springToLinearEasing(spring)).toBe(springToLinearEasing(spring));
  });
});

describe('motionTiming', () => {
  it('keeps every exit token critically damped', () => {
    for (const family of ['control', 'toggle', 'content', 'surface', 'spatial'] as const) {
      expect(motionTiming(family, 'out').bounce).toBe(0);
    }
  });

  it('keeps every entrance token shorter than its spatial sibling', () => {
    for (const family of ['control', 'toggle', 'content', 'surface'] as const) {
      expect(motionDuration(family, 'in')).toBeLessThan(motionDuration('spatial', 'in'));
    }
  });

  it('makes exits faster than entrances', () => {
    for (const family of ['control', 'toggle', 'content', 'surface', 'spatial'] as const) {
      expect(motionDuration(family, 'out')).toBeLessThan(motionDuration(family, 'in'));
    }
  });
});

/** Reference implementation kept independent of the module under test. */
function springAtReference(spring: { stiffness: number; damping: number; mass: number }, t: number) {
  const { stiffness, damping, mass } = spring;
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1 - 1e-6) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    return (
      1 - Math.exp(-zeta * omega0 * t) * (Math.cos(omegaD * t) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * t))
    );
  }
  return 1 - Math.exp(-omega0 * t) * (1 + omega0 * t);
}