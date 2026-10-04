//! Compositor-layer budget control.
//!
//! Promoting an element to its own layer makes animation cheap, but a promoted
//! layer costs memory and, past a certain count, makes the compositor the
//! bottleneck instead of the main thread. The usual workaround — leaving
//! `will-change` on permanently — is worse: it burns VRAM for elements that are
//! not moving and defeats the very purpose.
//!
//! So promotion is refcounted. Every animation asks for the layer it needs and
//! releases it on completion; overlapping animations share one promotion, and a
//! surface that animates repeatedly never accumulates stale hints.
//!
//! The second job here is enforcement. `assertCompositedOnly` turns "animate only
//! transform/opacity" from a convention into a checked invariant, so a future
//! `left`/`width` tween fails a test instead of silently costing a layout per
//! frame.

/** Properties that can be animated without triggering layout or paint. */
const COMPOSITED = new Set(['transform', 'opacity']);

/**
 * Properties that are legitimately animated on user input or for non-motion
 * reasons, where a layout pass per frame is inherent to the interaction (a
 * pointer-driven resize, a scroll-follow) rather than a mistake.
 */
const INPUT_DRIVEN = new Set(['left', 'top', 'right', 'bottom', 'width', 'height']);

interface Promotion {
  count: number;
  value: string;
}

const promotions = new WeakMap<HTMLElement, Promotion>();

/**
 * Request a compositor layer for `element` for the duration of one animation.
 * Returns the matching release function; calling it twice is a no-op.
 */
export function promote(element: HTMLElement | null, properties: readonly string[] = COMPOSITED_PROPS): () => void {
  if (!element) return () => {};
  const value = properties.join(', ');
  const existing = promotions.get(element);
  if (existing) {
    existing.count += 1;
  } else {
    promotions.set(element, { count: 1, value });
    element.style.setProperty('will-change', value);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = promotions.get(element);
    if (!current) return;
    current.count -= 1;
    if (current.count > 0) return;
    promotions.delete(element);
    element.style.removeProperty('will-change');
  };
}

const COMPOSITED_PROPS = ['transform', 'opacity'] as const;

/**
 * Report any animated property that would leave the compositor thread.
 *
 * Returns the offenders so a caller (or a test) can fail loudly. Pointer-driven
 * geometry is excused, since the layout work there is caused by the user's own
 * input rather than by the animation system.
 */
export function assertCompositedOnly(
  properties: Record<string, unknown>,
  context: { inputDriven?: boolean } = {}
): string[] {
  const offenders: string[] = [];
  for (const key of Object.keys(properties)) {
    if (COMPOSITED.has(key) || context.inputDriven) continue;
    if (INPUT_DRIVEN.has(key)) offenders.push(key);
  }
  return offenders;
}

/** Test seam: how many promotions an element currently holds. */
export function promotionCount(element: HTMLElement): number {
  return promotions.get(element)?.count ?? 0;
}