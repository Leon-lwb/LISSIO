//! Spring → CSS `linear()` easing tokens.
//!
//! CSS cannot express a damped oscillator, but it *can* express an arbitrary
//! easing function, and `linear()` accepts output values outside `[0, 1]` — which
//! is exactly what a spring overshoot is. So the spring response is sampled once
//! and written to a custom property, and every CSS transition in the app becomes
//! physically correct while still running on the compositor thread (durations and
//! easings are resolved during style computation, never per frame).
//!
//! This is what keeps the two animation systems coherent: `motionConfig` holds
//! the springs, this module projects them into CSS, and `gsapSpring` evaluates the
//! same spring per frame in JavaScript. One source, three projections.

import {
  motionDuration,
  motionSpeed,
  motionSpring,
  type MotionFamily,
  type MotionPhase,
  type MotionPresenceVariant,
  type MotionSpeed,
} from './motionConfig';
import {
  VARIANT_GEOMETRY,
  cssScaleToken,
  cssScaleValue,
  cssTravelToken,
  cssTravelValue,
} from './presence';
import { motionIsReduced } from '../utils/reducedMotion';
import { springAt, springSettleTime, type Spring } from './spring';

const FAMILIES: readonly MotionFamily[] = ['control', 'toggle', 'content', 'surface', 'spatial'];
const PHASES: readonly MotionPhase[] = ['in', 'out'];
const VARIANTS = Object.keys(VARIANT_GEOMETRY) as MotionPresenceVariant[];

/** Stops per easing. Springs that overshoot need the extra resolution to show it. */
const SAMPLES = { bouncy: 48, monotone: 24 } as const;

/** Collapsed duration emitted while reduced motion is active, in ms. */
const REDUCED_MS = '1ms';

const cache = new Map<string, string>();

function round(value: number): string {
  const rounded = Math.round(value * 10000) / 10000;
  // Avoid "-0" and exponent-free output so the token stays diff-friendly.
  return rounded === 0 ? '0' : String(rounded);
}

/**
 * Sample a spring into a CSS `linear()` easing function spanning exactly its
 * settle time, so the transition is never truncated mid-bounce.
 */
export function springToLinearEasing(spring: Spring): string {
  const settle = springSettleTime(spring);
  const key = `${spring.stiffness.toFixed(6)}|${spring.damping.toFixed(6)}|${settle.toFixed(6)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const samples = spring.damping < 2 * Math.sqrt(spring.stiffness) ? SAMPLES.bouncy : SAMPLES.monotone;
  const stops: string[] = [];
  for (let i = 0; i <= samples; i += 1) {
    stops.push(round(springAt(spring, (i / samples) * settle)));
  }
  // The endpoints must be exactly the identity so an interrupted transition
  // hands control back cleanly.
  stops[0] = '0';
  stops[stops.length - 1] = '1';

  const value = `linear(${stops.join(', ')})`;
  cache.set(key, value);
  return value;
}

/**
 * Install every motion token on the document root: `--ease-*`,
 * `--motion-duration-*`, and the per-role `--motion-travel-*` /
 * `--motion-scale-*` geometry the CSS fallback keyframes read.
 *
 * Safe to call repeatedly; only re-bakes when the inputs actually changed.
 * Returns true when the stylesheet values were rewritten.
 */
export function installMotionTokens(force = false): boolean {
  if (typeof document === 'undefined') return false;
  const speed = motionSpeed();
  const reduced = motionIsReduced();
  const root = document.documentElement;
  if (!force && root.dataset.motionTokens === signature(speed, reduced)) return false;
  root.dataset.motionTokens = signature(speed, reduced);

  const style = root.style;
  for (const family of FAMILIES) {
    for (const phase of PHASES) {
      const durationVar = `--motion-duration-${family}-${phase}`;
      const easeVar = `--ease-${family}-${phase}`;
      if (reduced) {
        // Reduced motion keeps the state change, drops the travel: a 1ms
        // transition is still a transition, so hover/focus logic stays intact.
        style.setProperty(durationVar, REDUCED_MS);
        style.setProperty(easeVar, 'linear');
        continue;
      }
      style.setProperty(durationVar, `${Math.round(motionDuration(family, phase) * 1000)}ms`);
      style.setProperty(easeVar, springToLinearEasing(motionSpring(family, phase)));
    }
  }

  // 浮层几何与时长/缓动同批烘焙, 理由是一样的: presence.ts 的 VARIANT_GEOMETRY 是
  // 唯一的数值来源, 关键帧只消费 token。曾经关键帧各自写死偏移, 于是同一个角色在
  // CSS 兜底路径与 GSAP 路径上走的是两个不同的值 (banner 5px vs 8px) —— 差异取决于
  // JS 是否已经把令牌写进 <html>, 两边都"合法"所以谁也不会报错。收敛之后
  // easingTokens.test.ts 逐个角色比对本函数写入的值与 VARIANT_GEOMETRY。
  //
  // 减速偏好下把位移压到 0 并把缩放压到 1 —— 关键帧仍会播 (时长 1ms 已在
  // reduced-motion.css 里压过), 只是不再移动或缩放任何像素。
  for (const variant of VARIANTS) {
    style.setProperty(cssTravelToken(variant), reduced ? '0px, 0px' : cssTravelValue(variant));
    style.setProperty(cssScaleToken(variant), reduced ? '1' : cssScaleValue(variant));
  }
  return true;
}

function signature(speed: MotionSpeed, reduced: boolean): string {
  return `${speed}|${reduced ? 'reduced' : 'full'}`;
}