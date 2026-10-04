//! FLIP for panels that change slot inside one panel group.
//!
//! `react-resizable-panels` reorders by sorting on each panel's `order`, and the
//! DOM node survives that sort — so a panel moving from the left dock to the
//! right dock is already sitting in its new slot before the browser paints. Only
//! the continuity is missing, and FLIP supplies it: remember where each panel
//! was, put it back at that offset, and let the spatial spring carry it across.
//!
//! Two deliberate limits:
//! - Visibility is not a trigger. Hiding a panel changes its width, which
//!   `docked-panel.css` already animates with a flex-grow transition; a FLIP on top
//!   would compete with that transition for the same pixels.
//! - Only `transform` is animated. Width and height are measured, never tweened —
//!   a panel keeps its size across a dock change because the layout store is keyed
//!   by panel id, so a size animation would be animating a difference that does
//!   not exist.

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import gsap from 'gsap';
import { promote } from './compositor';
import { ensureSpringPlugin, springTween } from './gsapSpring';
import { motionSpringFor } from './motionConfig';
import { motionIsReduced } from './reducedMotion';

/** Marks a panel as FLIP-tracked; its value identifies the panel across reorders. */
const FLIP_KEY_ATTR = 'data-flip-key';

/** Positional change below this is layout noise rather than a move. */
const MIN_TRAVEL_PX = 0.5;

/** Lifts a travelling panel above the neighbours it crosses on the way. */
const TRAVEL_Z = 2;

interface Slot {
  left: number;
  top: number;
}

interface Offset {
  x: number;
  y: number;
}

function flipKey(element: HTMLElement): string {
  return element.getAttribute(FLIP_KEY_ATTR) ?? '';
}

/** Live `translate`, which has to come back out before the slot can be compared. */
function liveOffset(element: HTMLElement): Offset {
  return {
    x: Number(gsap.getProperty(element, 'x')) || 0,
    y: Number(gsap.getProperty(element, 'y')) || 0,
  };
}

/** Tracked panels inside `root`, in document order. */
function trackedPanels(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[${FLIP_KEY_ATTR}]`));
}

/**
 * Settled slot of each panel — its layout position with any in-flight translation
 * removed.
 *
 * The subtraction is the whole point: a panel still travelling from an earlier
 * reorder reports its *animated* box, and comparing that against a settled slot
 * invents a delta that never happened (the panel would bounce the wrong way).
 */
function measureSlots(panels: HTMLElement[]): Map<string, Slot> {
  const slots = new Map<string, Slot>();
  for (const element of panels) {
    const rect = element.getBoundingClientRect();
    const offset = liveOffset(element);
    slots.set(flipKey(element), { left: rect.left - offset.x, top: rect.top - offset.y });
  }
  return slots;
}

/**
 * FLIP the panels inside `container` whenever `trigger` changes.
 *
 * `trigger` must encode the group *ordering* — which side each panel occupies —
 * and nothing else. Anything that changes a panel's size rather than its slot is
 * already animated by the panel's own width transition.
 */
export function useDockReorder(container: RefObject<HTMLElement | null>, trigger: string): void {
  ensureSpringPlugin();

  const slots = useRef<Map<string, Slot> | null>(null);
  const lastTrigger = useRef<string | null>(null);

  // Resizing the window moves every slot without re-rendering this subtree, so
  // the remembered rectangles would go stale and the next reorder would animate
  // from a position the panel was never at. Re-measuring on resize keeps the
  // origin honest without measuring on every render.
  useEffect(() => {
    const sync = () => {
      const root = container.current;
      if (root) slots.current = measureSlots(trackedPanels(root));
    };
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [container]);

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;

    const panels = trackedPanels(root);
    const current = measureSlots(panels);

    const before = slots.current;
    const reordered = lastTrigger.current !== null && lastTrigger.current !== trigger;
    slots.current = current;
    lastTrigger.current = trigger;

    // The first pass has no slot to compare against, and reduced motion keeps the
    // state change while dropping the travel.
    if (!reordered || before === null || motionIsReduced()) return;

    for (const element of panels) {
      const key = flipKey(element);
      const from = before.get(key);
      const to = current.get(key);
      if (!from || !to) continue;

      const dx = from.left - to.left;
      const dy = from.top - to.top;
      const distance = Math.hypot(dx, dy);
      if (distance < MIN_TRAVEL_PX) continue;

      const release = promote(element);
      gsap.killTweensOf(element);
      gsap.set(element, { x: dx, y: dy, zIndex: TRAVEL_Z });
      gsap.to(element, {
        ...springTween('spatial', 'in', { x: 0, y: 0 }, {
          spring: motionSpringFor('spatial', 'in', distance),
        }),
        onComplete: () => {
          gsap.set(element, { clearProps: 'transform,zIndex' });
          release();
        },
      });
    }
  });
}
