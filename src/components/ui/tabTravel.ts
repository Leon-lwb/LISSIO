/** Travel rules for switching between ordered items (tab strips, stacked settings). */

/** Full-index travel. One step is subtle; crossing the whole strip is not. */
const MAX_TRAVEL = 18;

/** Vertical strips travel less than horizontal ones for the same jump. */
const AXIS_FACTOR = { x: 1, y: 0.6 } as const;

/**
 * Signed travel for a switch, in px, along the given axis.
 *
 * Direction comes from where the new key sits relative to the old one, and the
 * magnitude scales with how many positions were crossed: nudging one tab should
 * not read the same as jumping the length of the strip. Returns 0 when the two
 * keys have no spatial relationship, which degrades to a pure cross-fade.
 */
export function switchTravel(
  from: string,
  to: string,
  order: readonly string[] | undefined,
  axis: 'x' | 'y' | undefined
): number {
  if (!order || !axis) return 0;
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return 0;
  const steps = Math.abs(toIdx - fromIdx);
  const direction = toIdx > fromIdx ? 1 : -1;
  return direction * AXIS_FACTOR[axis] * Math.min(MAX_TRAVEL, 4 + (steps - 1) * 6);
}