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

/**
 * Travel vector in px. Sign encodes which edge the surface belongs to.
 */
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
 * Nominal geometry per role — where a surface comes from, where it goes to, and
 * which point it scales out of.
 *
 * `motion.css` does **not** repeat these numbers. `installMotionTokens` projects
 * every role onto `--motion-travel-<role>` / `--motion-scale-<role>`, and each
 * entrance keyframe reads the tokens of its own role. Without that projection the
 * two systems drifted: the keyframes hardcoded their own offsets, so a banner
 * travelled 5px on the CSS fallback path and 8px on the GSAP path — the same role,
 * two different animations, depending on whether JS had installed the tokens yet.
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
 * window's right edge instead of fading in place.
 *
 * 退场朝同一条边退, 与进场互为镜像: 缩放原点不变, 于是表面是被**压回它所属的边**
 * 而不是原地淡出。位移同样指向边外侧, 与缩放同向 —— 面板盒子在此刻仍是满宽的
 * (宽度要等退场播完才收), 所以越出盒子的那一小段会被 `overflow: hidden` 裁掉。
 * 这不是妥协: 位移与缩放都朝同一边, 被裁掉的恰好是已经贴到边框上的部分, 于是
 * 读出来仍是"被收进边框", 而不是被抹掉一刀。
 */
export interface DockPanelGeometry {
  /** CSS `transform-origin` — the edge the panel is docked to. */
  origin: string;
  /** Displacement an entrance begins from. */
  enterFrom: TravelVector;
  /** Scale at the entrance's far end. */
  enterScale: number;
  /** 退场终点的位移, 方向即实际方向 (朝所属边外侧)。 */
  exitTo: TravelVector;
  /** 退场终点的缩放, 相对所属边收缩。 */
  exitScale: number;
}

/** 退场朝边外侧走多远, px。位移与缩放同向, 所以不需要大 —— 大了只会被裁掉。 */
const DOCK_EXIT_TRAVEL_PX = 10;

const DOCK_PANEL_GEOMETRY: Record<DockEdge, DockPanelGeometry> = {
  left: {
    origin: 'left center',
    enterFrom: { x: -DOCK_TRAVEL_PX, y: 0 },
    enterScale: 0.98,
    exitTo: { x: -DOCK_EXIT_TRAVEL_PX, y: 0 },
    exitScale: 0.9,
  },
  right: {
    origin: 'right center',
    enterFrom: { x: DOCK_TRAVEL_PX, y: 0 },
    enterScale: 0.98,
    exitTo: { x: DOCK_EXIT_TRAVEL_PX, y: 0 },
    exitScale: 0.9,
  },
  // A bottom panel spans the full window width, so its scale stays near 1: a
  // uniform shrink would narrow a drawer that should only retract vertically.
  // 同一条理由也压住了它的退场收缩量 —— 横向收窄整条抽屉是错的读法。
  bottom: {
    origin: 'center bottom',
    enterFrom: { x: 0, y: DOCK_TRAVEL_PX },
    enterScale: 0.99,
    exitTo: { x: 0, y: DOCK_EXIT_TRAVEL_PX },
    exitScale: 0.97,
  },
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
 *
 * 离场方向由调用方按真实归属给时走 `exitVars`; 这里的 `exitTo` 是**进场偏移的
 * 镜像空间** (出口取负), 它的方向缺陷另有记录, 不在这里顺手改掉。
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

/**
 * 离场目标值, 允许调用方给出真实的离开方向。
 *
 * 与 `travelVars` 的差别只有一处, 但那一处是这整个接口存在的理由: 这里的
 * `travel` 是**实际位移**, 方向就是它写的那一遍; 而 `VariantGeometry.exitTo`
 * 表达的是进场偏移的镜像, 出口要取负。停靠面板必须知道自己属于哪条边才能决定
 * 往哪边退, 这件事没法从角色表里的名义值推出来, 所以由调用方直接给。
 *
 * 只有一个参数给过时才走这里 —— 两个都没给就退回角色表, 让绝大多数表面不必关心。
 */
export function exitVars(
  geometry: VariantGeometry,
  travel?: TravelVector,
  scale?: number
): gsap.TweenVars {
  if (!travel && scale === undefined) return travelVars(geometry, 'exit');
  const from = travel ?? NO_TRAVEL;
  const endScale = scale ?? geometry.exitScale;
  return { opacity: 0, x: from.x, y: from.y, scaleX: endScale, scaleY: endScale };
}

/**
 * CSS custom property holding a role's entrance displacement, as the two
 * comma-separated arguments of a `translate()` (e.g. `0px, -6px`).
 *
 * 这个函数是**唯一的命名点**: `installMotionTokens` 按它写令牌, 关键帧按它读令牌。
 * 两边曾经各写一份数字, 于是同一条 banner 在无 JS 的兜底路径走 5px、在 GSAP 路径
 * 走 8px —— 同一个角色, 两套动画, 取决于 JS 有没有装好令牌。
 *
 * 逗号是必须的: 令牌被塞进 `translate(...)` 而不是 `translateY(...)`, 空格分隔的
 * 两值会让整条 `transform` 在计算值阶段失效, 连缩放一起丢掉。
 */
export function cssTravelToken(variant: MotionPresenceVariant): string {
  return `--motion-travel-${variant}`;
}

/** 同上, 持有该角色进场的缩放 (`enterScale`), 无单位。 */
export function cssScaleToken(variant: MotionPresenceVariant): string {
  return `--motion-scale-${variant}`;
}

/**
 * 写入 `cssTravelToken(variant)` 的值。
 *
 * 输出形如 `0px, -6px`, 直接作为 `translate()` 的两个参数。
 */
export function cssTravelValue(variant: MotionPresenceVariant): string {
  const { x, y } = VARIANT_GEOMETRY[variant].enterFrom;
  return `${x}px, ${y}px`;
}

/** 写入 `cssScaleToken(variant)` 的值。 */
export function cssScaleValue(variant: MotionPresenceVariant): string {
  return String(VARIANT_GEOMETRY[variant].enterScale);
}