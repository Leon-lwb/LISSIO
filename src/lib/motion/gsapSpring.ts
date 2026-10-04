//! GSAP integration for physical springs.
//!
//! GSAP eases with bezier curves, which cannot represent a damped oscillator. This
//! plugin runs the same closed-form spring the CSS `linear()` tokens are sampled
//! from, so a tween and a transition driven by the same token are the same
//! motion — no drift between the JS-driven and CSS-driven halves of the app.
//!
//! Implementation notes:
//! - The tween keeps a real duration (the spring's settle time) so GSAP's clock,
//!   lag smoothing, `stagger`, `overwrite` and interrupt bookkeeping all behave.
//! - Tweens run with `ease: 'none'`; `render` receives linear progress and maps
//!   it through the spring, so the easing curve lives in the solver, not in GSAP.
//! - Values are written through cached `quickSetter`s, and the plugin only ever
//!   touches properties the caller listed, which keeps animations on the
//!   compositor by construction.

import gsap from 'gsap';
import { motionSpring, type MotionFamily, type MotionPhase } from './motionConfig';
import { motionIsReduced } from './reducedMotion';
import { springAtWithVelocity, springSettleTime, type Spring } from './spring';

/** Tween vars owned by the plugin rather than by a target property. */
const PLUGIN_VARS = new Set([
  'spring',
  'springDuration',
  'initialVelocity',
  'ease',
  'duration',
  'delay',
  'onComplete',
  'onUpdate',
  'onStart',
  'onStartParams',
  'onCompleteParams',
  'onUpdateParams',
  'onReverseComplete',
  'paused',
  'repeat',
  'yoyo',
  'repeatDelay',
  'stagger',
  'overwrite',
  'id',
  'data',
  'runBackwards',
  'immediateRender',
  'startAt',
  'keyframes',
  'scrollTrigger',
]);

export interface SpringTweenVars extends gsap.TweenVars {
  /** Spring to evaluate. Supersedes `ease` — the spring *is* the curve. */
  spring?: Spring;
  /** Override tween length; defaults to the spring's own settle time. */
  springDuration?: number;
  /**
   * Launch speed, in units of the tweened distance per second. Zero — the default
   * — is the from-rest response; a non-zero value hands the tween momentum, as
   * when a released drag carries the speed the pointer had. Keep it within
   * `springNoOvershootVelocity(spring)` for anything that must arrive without
   * sailing past its target.
   */
  initialVelocity?: number;
}

interface SpringRunData {
  spring: Spring;
  duration: number;
  initialVelocity: number;
  setters: ((value: number) => void)[];
  from: number[];
  to: number[];
}

function numericKeys(vars: SpringTweenVars): string[] {
  return Object.keys(vars).filter((key) => {
    if (PLUGIN_VARS.has(key)) return false;
    const value = (vars as Record<string, unknown>)[key];
    return typeof value === 'number';
  });
}

const SpringEasePlugin = {
  name: 'springEase',
  version: '1.0.0',
  init(
    targets: gsap.TweenTarget,
    vars: SpringTweenVars,
    tween: gsap.core.Tween
  ): SpringRunData {
    const spring = vars.spring ?? CRITICAL_SPRING;
    const duration = vars.springDuration ?? springSettleTime(spring);
    const keys = numericKeys(vars);
    const list = gsap.utils.toArray<gsap.TweenTarget>(targets);

    const setters: ((value: number) => void)[] = [];
    const from: number[] = [];
    const to: number[] = [];

    for (const target of list) {
      for (const key of keys) {
        // Read the live value so an interrupted spring restarts from where it
        // actually is, instead of snapping back to the previous target first.
        from.push(parseFloat(gsap.getProperty(target, key) as string) || 0);
        to.push((vars as unknown as Record<string, number>)[key]);
        setters.push(gsap.quickSetter(target, key) as (value: number) => void);
      }
    }

    // Give the tween a real duration so GSAP's clock, lag smoothing,
    // `overwrite` and interrupt bookkeeping behave; the spring is evaluated
    // from that clock in `render`.
    if (duration > 0) tween.duration(duration);
    return {
      spring,
      duration,
      initialVelocity: vars.initialVelocity ?? 0,
      setters,
      from,
      to,
    };
  },
  render(ratio: number, data: gsap.PluginScope): void {
    const run = data as unknown as SpringRunData;
    const progress = springAtWithVelocity(run.spring, ratio * run.duration, run.initialVelocity);
    for (let i = 0; i < run.setters.length; i += 1) {
      const base = run.from[i];
      const delta = run.to[i] - base;
      if (delta === 0) continue;
      run.setters[i](base + delta * progress);
    }
  },
} satisfies gsap.Plugin;

/** Neutral fallback so a spring-less tween is still well defined. */
const CRITICAL_SPRING: Spring = { stiffness: 400, damping: 40, mass: 1 };

let registered = false;

/** Idempotent plugin registration; safe to call from any entry point. */
export function ensureSpringPlugin(): void {
  if (registered) return;
  registered = true;
  gsap.registerPlugin(SpringEasePlugin);
}

/**
 * Tween vars for a spring, with reduced motion and live-value reading handled.
 * `MotionPresence` and every FLIP transition go through here.
 */
export function springTween(
  family: MotionFamily,
  phase: MotionPhase,
  properties: Record<string, number | string>,
  extra: SpringTweenVars = {}
): SpringTweenVars {
  if (motionIsReduced()) {
    return { ...properties, duration: 0, ease: 'none', ...extra };
  }
  return {
    ...properties,
    spring: motionSpring(family, phase),
    ease: 'none',
    ...extra,
  };
}