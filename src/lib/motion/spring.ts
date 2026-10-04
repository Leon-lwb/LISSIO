//! Physical spring primitives.
//!
//! Every motion token in the app resolves to a damped harmonic oscillator rather
//! than a bezier curve: unit mass on a spring, released from 0 toward 1. The
//! closed-form response below costs O(1) per sample, so one solver drives both
//! the GSAP plugin (once per frame) and the CSS `linear()` baking (offline) — the
//! JavaScript and CSS paths physically cannot drift apart.
//!
//! Two rules are encoded here rather than left to each call site:
//! - Entrances may overshoot, because an arriving object settles into place.
//! - Exits are always critically damped: departing motion that wobbles reads as
//!   a rendering glitch, not as physics.

export interface Spring {
  /** ω₀² — restoring force per unit of displacement. */
  readonly stiffness: number;
  /** 2ζω₀ — velocity-proportional damping. */
  readonly damping: number;
  readonly mass: number;
}

export interface SpringTiming {
  /** Seconds until the response is perceptually settled. Exact by construction. */
  readonly duration: number;
  /** 0 = critically damped (no overshoot); higher = underdamped with visible bounce. */
  readonly bounce: number;
}

/** Peak deviation still considered "at rest". 0.15% sits below the perceptual threshold. */
export const SPRING_REST_DELTA = 0.0015;

/** Lower damping-ratio bound; below this a token is a decaying sine, not a transition. */
const MIN_DAMPING_RATIO = 0.25;

/** Shortest token we are willing to emit, in seconds. */
const MIN_DURATION = 0.05;

/** Bisection budget for the stiffness solve. 40 halvings pins ω₀ to ~1e-12 relative. */
const SOLVE_ITERATIONS = 40;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** ζ — damping ratio. <1 overshoots, 1 is critical, >1 crawls in. */
export function dampingRatio(spring: Spring): number {
  return spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass));
}

/**
 * Normalized step response of `spring`, released from rest at 0 with a target of
 * 1. Evaluates the exact closed-form solution, so it stays correct for any `t`
 * and can be sampled at arbitrary resolution without integration drift.
 */
export function springAt(spring: Spring, t: number): number {
  if (t <= 0) return 0;
  const { mass, stiffness, damping } = spring;
  if (stiffness <= 0) return 1;
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  if (zeta < 1 - 1e-6) {
    // Underdamped — decaying sinusoid.
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega0 * t);
    return 1 - decay * (Math.cos(omegaD * t) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * t));
  }
  if (zeta <= 1 + 1e-6) {
    // Critically damped — repeated real root.
    const decay = Math.exp(-omega0 * t);
    return 1 - decay * (1 + omega0 * t);
  }
  // Overdamped — two distinct real roots; r1 decays slower than r2.
  const root = omega0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * omega0 + root;
  const r2 = -zeta * omega0 - root;
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

/**
 * Instantaneous rate of change of the normalized response, per second.
 *
 * Closed-form rather than finite-differenced: a central difference at `t = 0`
 * degenerates to one-sided and reports a spurious launch velocity, which would
 * make an interrupted spring pick up momentum it never had.
 */
export function springVelocity(spring: Spring, t: number): number {
  if (t <= 0) return 0;
  const { mass, stiffness, damping } = spring;
  if (stiffness <= 0) return 0;
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  if (zeta < 1 - 1e-6) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    // d/dt [1 − e^(−ζω₀t)(cos ω_d t + (ζω₀/ω_d) sin ω_d t)]; the ζ²ω₀² term
    // cancels against the ω_d² term, leaving ω₀²/ω_d.
    return Math.exp(-zeta * omega0 * t) * ((omega0 * omega0) / omegaD) * Math.sin(omegaD * t);
  }
  if (zeta <= 1 + 1e-6) {
    return omega0 * omega0 * t * Math.exp(-omega0 * t);
  }
  const root = omega0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * omega0 + root;
  const r2 = -zeta * omega0 - root;
  const a = -r2 / (r2 - r1);
  const b = r1 / (r2 - r1);
  return a * r1 * Math.exp(r1 * t) + b * r2 * Math.exp(r2 * t);
}

/**
 * Slowest exponential decay rate in the response. Used to size the search
 * horizon so `springSettleTime` never truncates a still-oscillating spring.
 */
function decayRate(spring: Spring): number {
  const omega0 = Math.sqrt(spring.stiffness / spring.mass);
  const zeta = dampingRatio(spring);
  const slowRoot = zeta > 1 ? zeta - Math.sqrt(Math.max(zeta * zeta - 1, 0)) : zeta;
  return omega0 * clamp(slowRoot, 0.02, 1);
}

/**
 * Time after which the response never again leaves the rest band.
 *
 * A linear spring is a sum of decaying exponentials, so once the horizon is long
 * enough for the slowest term to vanish the response is provably settled. The
 * coarse pass finds the last excursion; the bisection then pins the crossing to
 * full float precision. Quantising the answer to the scan grid instead would make
 * the stiffness solve in `springFromTiming` jitter, because stiffness scales with
 * 1/duration² and the grid error is re-amplified on every solve.
 *
 * The scan density is derived from the oscillation rather than fixed in time. An
 * excursion lobe is half a cycle wide, so a fixed grid dense enough for a slow
 * spring spends thousands of samples proving that nothing happens after the first
 * lobe — which is exactly the shape of the work this function does most of.
 */
export function springSettleTime(spring: Spring): number {
  const { mass, stiffness, damping } = spring;
  if (stiffness <= 0) return 0;
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const angular = zeta < 1 ? omega0 * Math.sqrt(1 - zeta * zeta) : omega0;

  const horizon = 14 / decayRate(spring);
  const halfCycle = Math.PI / Math.max(angular, 1e-6);
  // 16 samples per excursion lobe: enough that no lobe can fall between two
  // samples and be missed entirely.
  const steps = clamp(Math.ceil((horizon / halfCycle) * 16), 48, 4096);
  const step = horizon / steps;
  const outside = (t: number) => Math.abs(springAt(spring, t) - 1) > SPRING_REST_DELTA;

  let last = -1;
  for (let i = 0; i <= steps; i += 1) {
    if (outside(i * step)) last = i;
  }
  if (last < 0) return 0;
  if (last === steps) return horizon;

  // `last * step` is inside the final excursion and `(last + 1) * step` is
  // outside it by construction, so the boundary always lies between them.
  let low = last * step;
  let high = Math.min((last + 1) * step, horizon);
  for (let i = 0; i < 40 && high - low > 1e-9; i += 1) {
    const mid = (low + high) / 2;
    if (outside(mid)) low = mid;
    else high = mid;
  }
  return high;
}

function springAtOmega(omega0: number, zeta: number): Spring {
  return { stiffness: omega0 * omega0, damping: 2 * zeta * omega0, mass: 1 };
}

/**
 * Derive the spring whose settle time is exactly `timing.duration`.
 *
 * Solving rather than copying a fixed (stiffness, damping) pair is what makes the
 * token layer honest: a designer-authored `duration: 0.52` really does read as
 * half a second at any bounce level, and a bounce sweep stays continuous across
 * the critically damped boundary where a closed-form stiffness formula kinks.
 */
export function springFromTiming({ duration, bounce }: SpringTiming): Spring {
  const target = Math.max(duration, MIN_DURATION);
  const zeta = clamp(1 - bounce, MIN_DAMPING_RATIO, 1);

  // settleTime decreases monotonically in ω₀, so geometric bisection converges.
  let low = 1;
  let high = 400;
  for (let i = 0; i < SOLVE_ITERATIONS; i += 1) {
    const mid = Math.sqrt(low * high);
    if (springSettleTime(springAtOmega(mid, zeta)) > target) low = mid;
    else high = mid;
  }
  return springAtOmega(Math.sqrt(low * high), zeta);
}

/** Duration a spring would run for if handed straight to a tween. */
export function springDuration(spring: Spring): number {
  return springSettleTime(spring);
}

/**
 * Re-solve a spring so that a change in travel distance reads correctly.
 *
 * Amplitude alone does not slow a real spring, but perception does: a surface
 * crossing 600px feels sluggish on the same 280ms that suits a 40px popover. We
 * stretch duration with a logarithmic (not linear) law and grow bounce with it,
 * because longer flights reveal more of the settle.
 */
export function spatialTiming(timing: SpringTiming, distancePx: number): SpringTiming {
  const distance = Math.max(Math.abs(distancePx), 0);
  const stretch = clamp(1 + Math.log1p(distance / 120) * 0.28, 1, 1.55);
  return {
    duration: timing.duration * stretch,
    bounce: clamp(timing.bounce * (1 + (stretch - 1) * 0.5), 0, 0.5),
  };
}