import { afterEach, describe, expect, it, vi } from 'vitest';
import { motionDuration, motionSpring, motionTiming, type MotionPresenceVariant } from '../motionConfig';
import { installMotionTokens, springToLinearEasing } from '../easingTokens';
import { VARIANT_GEOMETRY, cssScaleToken, cssTravelToken } from '../presence';
import { springSettleTime, SPRING_REST_DELTA } from '../spring';

const VARIANTS = Object.keys(VARIANT_GEOMETRY) as MotionPresenceVariant[];

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

describe('installMotionTokens', () => {
  // jsdom 没有 matchMedia, reducedMotion 因此把环境当作"已开启减弱动效"。
  // 这里显式声明偏好, 让断言不依赖那个默认推断。
  function stubMatchMedia(matches: boolean) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.motionTokens;
    document.documentElement.removeAttribute('style');
  });

  it('projects every variant geometry onto its own travel and scale token', () => {
    stubMatchMedia(false);
    expect(installMotionTokens(true)).toBe(true);

    // 期望值写成字面量而不是读 VARIANT_GEOMETRY: 读同一张表只能证明"投影等于它自己",
    // 改表时两边一起变, 测试照样绿。这些数字是角色的外观契约 (横幅从上往下 8px、
    // 气泡从上方 6px 等), 改动应当在此处被显式确认。
    const expected: Record<string, string> = {
      overlay: '0px, 0px',
      surface: '0px, 10px',
      popover: '0px, -6px',
      menu: '0px, -6px',
      toast: '16px, 0px',
      banner: '0px, -8px',
      message: '0px, 8px',
      row: '0px, -4px',
      panel: '0px, 0px',
      window: '0px, 16px',
    };
    const expectedScale: Record<string, string> = {
      overlay: '1',
      surface: '0.97',
      popover: '0.97',
      menu: '0.97',
      toast: '0.98',
      banner: '1',
      message: '0.99',
      row: '1',
      panel: '0.98',
      window: '0.97',
    };

    expect(VARIANTS.slice().sort()).toEqual(Object.keys(expected).sort());
    const style = document.documentElement.style;
    for (const variant of VARIANTS) {
      expect(style.getPropertyValue(cssTravelToken(variant)).trim()).toBe(expected[variant]);
      expect(style.getPropertyValue(cssScaleToken(variant)).trim()).toBe(expectedScale[variant]);
    }
  });

  it('keeps travel comma-separated so translate() receives two values', () => {
    // translate() 收两个参数: 空格分隔会让整条 transform 计算值失效, 缩放一起丢。
    stubMatchMedia(false);
    installMotionTokens(true);

    const style = document.documentElement.style;
    for (const variant of VARIANTS) {
      const travel = style.getPropertyValue(cssTravelToken(variant));
      expect(travel).toContain(',');
      expect(travel.split(',')).toHaveLength(2);
    }
  });

  it('collapses travel to zero and scale to one under reduced motion', () => {
    stubMatchMedia(true);
    installMotionTokens(true);

    const style = document.documentElement.style;
    for (const variant of VARIANTS) {
      expect(style.getPropertyValue(cssTravelToken(variant)).trim()).toBe('0px, 0px');
      expect(style.getPropertyValue(cssScaleToken(variant)).trim()).toBe('1');
    }
  });

  it('re-bakes only when the input signature actually changed', () => {
    stubMatchMedia(false);
    expect(installMotionTokens(true)).toBe(true);
    // 同档位重复调用不该重写整组令牌
    expect(installMotionTokens()).toBe(false);
    // 强制重烘焙仍然可行
    expect(installMotionTokens(true)).toBe(true);
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