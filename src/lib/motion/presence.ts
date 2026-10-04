//! Motion vocabulary for entering and leaving surfaces.
//!
//! Geometry is data, not duplicated tables. Each presence role declares the
//! family that times it, where it comes *from*, where it goes *to*, and which
//! point scaling grows out of — so the animation encodes where the surface
//! belongs in space instead of just fading.
//!
//! Entrances and exits are deliberately different objects:
//! - An entrance arrives from its origin and settles, so it may overshoot.
//! - An exit leaves, so it is critically damped and never overshoots; departure
//!   that wobbles reads as a glitch rather than as physics.

import type { MotionFamily, MotionPresenceVariant } from './motionConfig';

/** Travel vector in px. Sign encodes which edge the surface belongs to. */
export interface TravelVector {
  x: number;
  y: number;
}

export interface VariantGeometry {
  family: MotionFamily;
  /** Displacement at the start of an entrance. */
  enterFrom: TravelVector;
  /** Displacement at the end of an exit. Never larger than `enterFrom`. */
  exitTo: TravelVector;
  /** Scale at the entrance's far end. */
  enterScale: number;
  /** Scale at the exit's far end. */
  exitScale: number;
  /**
   * Transform origin. Scaling grows or shrinks a surface *away from* this point,
   * which is what makes a popover look like it came out of its trigger rather
   * than appearing in place.
   */
  origin: string;
  /** Opacity-only roles skip displacement so they never imply a position. */
  displaces: boolean;
}

const NO_TRAVEL: TravelVector = { x: 0, y: 0 };

/**
 * Nominal travel per role. These are the values the CSS keyframes also use, so a
 * role animates identically whether it is driven by GSAP or by an `animation`.
 */
export const VARIANT_GEOMETRY: Record<MotionPresenceVariant, VariantGeometry> = {
  // A scrim has no position of its own; only its opacity means anything.
  overlay: {
    family: 'surface',
    enterFrom: NO_TRAVEL,
    exitTo: NO_TRAVEL,
    enterScale: 1,
    exitScale: 1,
    origin: 'center',
    displaces: false,
  },
  // Dialogs rise and grow from the centre of attention.
  surface: {
    family: 'surface',
    enterFrom: { x: 0, y: 10 },
    exitTo: { x: 0, y: 4 },
    enterScale: 0.97,
    exitScale: 0.985,
    origin: 'center',
    displaces: true,
  },
  // Menus and popovers emerge from their anchor; callers override `origin` when
  // the anchor is above the surface rather than below it.
  popover: {
    family: 'surface',
    enterFrom: { x: 0, y: -6 },
    exitTo: { x: 0, y: -3 },
    enterScale: 0.97,
    exitScale: 0.985,
    origin: 'top center',
    displaces: true,
  },
  menu: {
    family: 'surface',
    enterFrom: { x: 0, y: -6 },
    exitTo: { x: 0, y: -3 },
    enterScale: 0.97,
    exitScale: 0.985,
    origin: 'top center',
    displaces: true,
  },
  // Toasts arrive from the edge they are stacked against.
  toast: {
    family: 'content',
    enterFrom: { x: 16, y: 0 },
    exitTo: { x: 24, y: 0 },
    enterScale: 0.98,
    exitScale: 1,
    origin: 'right center',
    displaces: true,
  },
  // Banners unroll from the top edge.
  banner: {
    family: 'content',
    enterFrom: { x: 0, y: -8 },
    exitTo: { x: 0, y: -8 },
    enterScale: 1,
    exitScale: 1,
    origin: 'top center',
    displaces: true,
  },
  // Messages settle upward into the conversation.
  message: {
    family: 'content',
    enterFrom: { x: 0, y: 8 },
    exitTo: { x: 0, y: 4 },
    enterScale: 0.99,
    exitScale: 1,
    origin: 'bottom center',
    displaces: true,
  },
  // Rows expand in place; they belong to a list, not to a corner.
  row: {
    family: 'content',
    enterFrom: { x: 0, y: -4 },
    exitTo: { x: 0, y: 0 },
    enterScale: 1,
    exitScale: 1,
    origin: 'center',
    displaces: true,
  },
  // Docked panels grow out of the edge they are docked to; the caller supplies
  // that edge as `origin`.
  panel: {
    family: 'spatial',
    enterFrom: { x: 0, y: 0 },
    exitTo: { x: 0, y: 0 },
    enterScale: 0.98,
    exitScale: 1,
    origin: 'center',
    displaces: false,
  },
  // Floating windows arrive from the corner they were spawned at, which is also
  // where their resize handle lives.
  window: {
    family: 'spatial',
    enterFrom: { x: 0, y: 16 },
    exitTo: { x: 0, y: 8 },
    enterScale: 0.97,
    exitScale: 0.99,
    origin: 'bottom right',
    displaces: true,
  },
};

/** Window edges a panel can be docked to. */
export type DockEdge = 'left' | 'right' | 'bottom';

/**
 * Nominal offset a docked panel starts its entrance from, in px.
 *
 * A docked panel's travel is mostly the width collapse it runs in CSS, which
 * already retracts toward the dock edge. This offset is the part a width cannot
 * express: where the panel sits relative to its own slot on the first frame.
 */
const DOCK_TRAVEL_PX = 28;

/**
 * Presence geometry for a panel docked to `edge`.
 *
 * The dock edge is the panel's real anchor, so scaling grows out of it and the
 * entrance offset points outboard of it — a right-docked panel arrives from the
 * window's right edge instead of fading in place. The exit carries no offset of
 * its own: the panel's width collapses toward the same edge, and a displacement
 * on top of a shrinking box would only push the content out of the window.
 */
export interface DockPanelGeometry {
  /** CSS `transform-origin` — the edge the panel is docked to. */
  origin: string;
  /** Displacement an entrance begins from. */
  enterFrom: TravelVector;
  /** Scale at the entrance's far end. */
  enterScale: number;
}

const DOCK_PANEL_GEOMETRY: Record<DockEdge, DockPanelGeometry> = {
  left: { origin: 'left center', enterFrom: { x: -DOCK_TRAVEL_PX, y: 0 }, enterScale: 0.98 },
  right: { origin: 'right center', enterFrom: { x: DOCK_TRAVEL_PX, y: 0 }, enterScale: 0.98 },
  // A bottom panel spans the full window width, so its scale stays near 1: a
  // uniform shrink would narrow a drawer that should only retract vertically.
  bottom: { origin: 'center bottom', enterFrom: { x: 0, y: DOCK_TRAVEL_PX }, enterScale: 0.99 },
};

export function dockPanelGeometry(edge: DockEdge): DockPanelGeometry {
  return DOCK_PANEL_GEOMETRY[edge];
}

/**
 * GSAP transform properties for a geometry phase.
 *
 * These are the tween *targets*, so the exit phase has to land on `opacity: 0`.
 * Exits used to target 1, which made every departure fully opaque — surfaces slid
 * away and then blinked out at the unmount instead of fading. A docked panel
 * cannot slide at all (its box is collapsing), so a missing fade left it sitting
 * at full opacity until the width hit zero.
 */
export function travelVars(geometry: VariantGeometry, phase: 'enter' | 'exit'): gsap.TweenVars {
  if (!geometry.displaces) return { opacity: 0 };
  const from = phase === 'enter' ? geometry.enterFrom : NO_TRAVEL;
  const to = phase === 'enter' ? NO_TRAVEL : geometry.exitTo;
  return {
    opacity: 0,
    x: from.x - to.x,
    y: from.y - to.y,
    scaleX: phase === 'enter' ? geometry.enterScale : geometry.exitScale,
    scaleY: phase === 'enter' ? geometry.enterScale : geometry.exitScale,
  };
}

/** CSS custom property pair consumed by the keyframe fallbacks. */
export function cssTravelToken(variant: MotionPresenceVariant): string {
  return `--motion-travel-${variant}`;
}