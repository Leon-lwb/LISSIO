//! Shared motion vocabulary for the frontend.
//!
//! Keep interaction animation intentional and compact: transforms/opacity for
//! movement, short durations for feedback, and slightly longer durations only
//! for spatial transitions. CSS aliases in `src/styles/theme.css` mirror these
//! values so CSS and GSAP stay visually aligned.

export type MotionSpeed = 'fast' | 'standard' | 'relaxed';
export type MotionDurationKey = 'micro' | 'quick' | 'base' | 'panel' | 'slow';
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

export const MOTION_DURATION = {
  instant: 0,
  micro: 0.14,
  quick: 0.18,
  base: 0.28,
  slow: 0.48,
  panel: 0.36,
} as const;

const SPEED_PROFILES: Record<MotionSpeed, Record<MotionDurationKey, number>> = {
  fast: { micro: 0.1, quick: 0.14, base: 0.2, panel: 0.28, slow: 0.36 },
  standard: { micro: 0.14, quick: 0.18, base: 0.28, panel: 0.36, slow: 0.48 },
  relaxed: { micro: 0.18, quick: 0.26, base: 0.36, panel: 0.48, slow: 0.64 },
};

export const MOTION_EASE = {
  enter: 'power4.out',
  exit: 'power2.in',
  standard: 'power2.inOut',
  settle: 'back.out(1.05)',
} as const;

export const MOTION_DISTANCE = {
  micro: 5,
  small: 10,
  panel: 24,
} as const;

export function motionSpeed(): MotionSpeed {
  const value = typeof document !== 'undefined'
    ? document.documentElement.dataset.motionSpeed
    : undefined;
  return value === 'fast' || value === 'relaxed' ? value : 'standard';
}

export function motionDuration(key: MotionDurationKey): number {
  return SPEED_PROFILES[motionSpeed()][key];
}

/** Both the OS preference and the in-app setting disable non-essential motion. */
export function motionIsReduced(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('reduced-motion')) {
    return true;
  }
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
