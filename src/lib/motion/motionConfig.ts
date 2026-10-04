//! Shared motion vocabulary for the frontend.
//!
//! Timing is expressed as physical springs (see `./spring`), not as bezier
//! curves or fixed millisecond pairs. Five semantic families cover the whole app,
//! each with an `in` and an `out` spring, and every consumer — CSS transitions,
//! CSS keyframes, GSAP tweens and FLIP transitions — resolves through the same
//! `motionSpring()` call so a token can never mean two different things.
//!
//! The `out` springs are critically damped by construction. An arriving surface
//! settles and may overshoot; a departing one must not wobble.

import {
  springFromTiming,
  springDuration,
  spatialTiming,
  type Spring,
  type SpringTiming,
} from './spring';

export type MotionSpeed = 'fast' | 'standard' | 'relaxed';

/**
 * The five motion families, ordered by how much of the screen they move.
 * `control` is imperceptibly short by design — it fires on every hover.
 */
export type MotionFamily = 'control' | 'toggle' | 'content' | 'surface' | 'spatial';

export type MotionPhase = 'in' | 'out';

/**
 * Presence roles. Timing comes from the family; only the departure vector and
 * transform origin differ, which is the part that encodes spatial logic
 * (a popover leaves toward the control that opened it).
 */
export type MotionPresenceVariant =
  | 'overlay'
  | 'surface'
  | 'popover'
  | 'toast'
  | 'panel'
  | 'row'
  | 'message'
  | 'window'
  | 'menu'
  | 'banner';

/** Author-facing timing intent at `standard` speed, before speed scaling. */
const BASE_TIMING: Record<MotionFamily, Record<MotionPhase, SpringTiming>> = {
  control: { in: { duration: 0.16, bounce: 0.06 }, out: { duration: 0.12, bounce: 0 } },
  toggle: { in: { duration: 0.24, bounce: 0.14 }, out: { duration: 0.18, bounce: 0 } },
  content: { in: { duration: 0.32, bounce: 0.18 }, out: { duration: 0.22, bounce: 0 } },
  surface: { in: { duration: 0.4, bounce: 0.22 }, out: { duration: 0.26, bounce: 0 } },
  spatial: { in: { duration: 0.52, bounce: 0.28 }, out: { duration: 0.3, bounce: 0 } },
};

const SPEED_SCALE: Record<MotionSpeed, { duration: number; bounce: number }> = {
  fast: { duration: 0.7, bounce: 0.6 },
  standard: { duration: 1, bounce: 1 },
  relaxed: { duration: 1.3, bounce: 1.15 },
};

/** Presence variant → motion family. */
const VARIANT_FAMILY: Record<MotionPresenceVariant, MotionFamily> = {
  overlay: 'surface',
  surface: 'surface',
  popover: 'surface',
  menu: 'surface',
  toast: 'content',
  row: 'content',
  message: 'content',
  banner: 'content',
  panel: 'spatial',
  window: 'spatial',
};

export function familyOf(variant: MotionPresenceVariant): MotionFamily {
  return VARIANT_FAMILY[variant];
}

export function motionSpeed(): MotionSpeed {
  const value =
    typeof document !== 'undefined' ? document.documentElement.dataset.motionSpeed : undefined;
  return value === 'fast' || value === 'relaxed' ? value : 'standard';
}

/**
 * Timing intent for a family/phase at the active speed. Cheap — callers that
 * need an actual `Spring` go through `motionSpring()`.
 */
export function motionTiming(family: MotionFamily, phase: MotionPhase): SpringTiming {
  const base = BASE_TIMING[family][phase];
  const scale = SPEED_SCALE[motionSpeed()];
  return { duration: base.duration * scale.duration, bounce: base.bounce * scale.bounce };
}

/** Resolved spring for a family/phase. Memoised because it runs per animation. */
export function motionSpring(family: MotionFamily, phase: MotionPhase): Spring {
  return springFromTiming(motionTiming(family, phase));
}

/**
 * Spring for a family/phase whose travel distance is known.
 *
 * Fixed-offset entrances pass their nominal offset. Measured transitions — a
 * dock panel relocating, a shared-element FLIP — pass the real pixel distance so
 * a 600px crossing is not read at the same pace as a 40px popover.
 */
export function motionSpringFor(
  family: MotionFamily,
  phase: MotionPhase,
  distancePx: number
): Spring {
  return springFromTiming(spatialTiming(motionTiming(family, phase), distancePx));
}

/** Settle time of the spring behind a family/phase, in seconds. */
export function motionDuration(family: MotionFamily, phase: MotionPhase): number {
  return springDuration(motionSpring(family, phase));
}

/** Nominal travel distance per variant, in px, for the CSS fallback offsets. */
export const MOTION_DISTANCE = {
  micro: 5,
  small: 10,
  panel: 24,
} as const;

export { springFromTiming, springDuration, spatialTiming, type Spring, type SpringTiming };
export { motionIsReduced } from './reducedMotion';