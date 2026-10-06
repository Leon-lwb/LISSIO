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

/**
 * Author-facing timing intent at `standard` speed, before speed scaling.
 *
 * This is the only place in the app where a motion value is chosen by hand.
 * Every `out` entry has `bounce: 0` — departures must not wobble — and that
 * invariant is asserted in the test suite rather than left to reviewers.
 *
 * 三个家族的重心压得比"物理直觉"更利落: 进场的主要成本是用户等待, 不是位移本身。
 * 离场比进场短一大截, `spatial/out` 只留 150ms: 停靠抽屉收起是**先播完退场才收
 * 布局**, 两段串行, 离场慢一点, 整个开合就被读成拖沓 —— 而这段时间画面上还
 * 没有可看的位移, 观众只会觉得"卡了一下"。所以离场只负责把面板交出去, 让位那一段
 * 交给面板组的 FLIP (那份时序按让位自己的意图选, 见 `dockFlip.ts`)。
 *
 * `surface` 与 `spatial` 的时长按"到位即可读出内容"的尺度给, 剩下的细化交给
 * `spatialTiming` 的行程拉伸 —— 名义偏移越大, 读起来才越需要时间; 反之, 一律
 * 按"大面板必须飞满半秒"给值, 弹窗就会慢到被读成卡顿。
 *
 * Exported so `scripts/gen-motion-docs.mjs` can render the tuning table from the
 * live values; a hand-copied table would drift silently.
 */
export const BASE_TIMING: Record<MotionFamily, Record<MotionPhase, SpringTiming>> = {
  control: { in: { duration: 0.16, bounce: 0.06 }, out: { duration: 0.12, bounce: 0 } },
  toggle: { in: { duration: 0.24, bounce: 0.14 }, out: { duration: 0.18, bounce: 0 } },
  content: { in: { duration: 0.26, bounce: 0.18 }, out: { duration: 0.18, bounce: 0 } },
  surface: { in: { duration: 0.3, bounce: 0.22 }, out: { duration: 0.2, bounce: 0 } },
  spatial: { in: { duration: 0.4, bounce: 0.28 }, out: { duration: 0.15, bounce: 0 } },
};

/** Multipliers applied to `BASE_TIMING` for each speed setting. */
export const SPEED_SCALE: Record<MotionSpeed, { duration: number; bounce: number }> = {
  fast: { duration: 0.7, bounce: 0.6 },
  standard: { duration: 1, bounce: 1 },
  relaxed: { duration: 1.3, bounce: 1.15 },
};

const FAMILIES: readonly MotionFamily[] = ['control', 'toggle', 'content', 'surface', 'spatial'];
const SPEEDS: readonly MotionSpeed[] = ['fast', 'standard', 'relaxed'];

/** Every family/phase combination, in declaration order. */
export function allMotionTokens(): {
  family: MotionFamily;
  phase: MotionPhase;
  speed: MotionSpeed;
}[] {
  const out: { family: MotionFamily; phase: MotionPhase; speed: MotionSpeed }[] = [];
  for (const speed of SPEEDS) {
    for (const family of FAMILIES) {
      for (const phase of ['in', 'out'] as const) out.push({ family, phase, speed });
    }
  }
  return out;
}

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
  return timingAt(family, phase, motionSpeed());
}

/** Timing intent for a family/phase at an explicit speed, ignoring the DOM. */
export function timingAt(
  family: MotionFamily,
  phase: MotionPhase,
  speed: MotionSpeed
): SpringTiming {
  const base = BASE_TIMING[family][phase];
  const scale = SPEED_SCALE[speed];
  return { duration: base.duration * scale.duration, bounce: base.bounce * scale.bounce };
}

/**
 * 让位 —— 列表里一次小范围局部位移的时序意图。
 *
 * 它刻意比任何家族令牌都快, 因为**事件本身比家族-进场/离场更小**。家族按"移动了屏幕
 * 多少"排序, `content` 那一档是消息、Toast、横幅 —— 整块表面的出现与消失。让位是相邻
 * 两三行之间挪一格, 借用 `content/out` 只能得到一个为更大的事件调的时长, 于是让位读起来
 * 拖沓: 观众已经看清行去了哪里, 动画还在收。
 *
 * 这是家族体系之外的第四种意图, 不是第六个家族 —— 家族描述的是"多大范围的表面", 而这里
 * 需要区分的是同范围内的"这是一个物体到达, 还是周围让开"。所以它是一份具名时序加一个
 * 解析器, 而不是新家族: 新家族会把五条 × 两相的调参表和生成文档都撑大, 而让位并不
 * 需要按家族分别调优。
 *
 * `bounce` 为 0 的理由与离场令牌同源: 让位没有来源也没有动量, 越过槽位再荡回来读起来
 * 是渲染故障。
 */
export const REFLOW_TIMING: SpringTiming = { duration: 0.14, bounce: 0 };

/**
 * 让位用的弹簧, 按实测让位距离拉伸。
 *
 * 走 `spatialTiming` 是为了距离感知仍然成立: 让位 20px 与让位 400px (删掉一个展开的块)
 * 不该是同一种速度。速度设置也照常生效, 与家族令牌走同一份 `SPEED_SCALE`。
 */
export function reflowSpring(distancePx: number): Spring {
  const scale = SPEED_SCALE[motionSpeed()];
  const timing = {
    duration: REFLOW_TIMING.duration * scale.duration,
    bounce: REFLOW_TIMING.bounce * scale.bounce,
  };
  return springFromTiming(spatialTiming(timing, distancePx));
}

/**
 * Resolved spring for a family/phase.
 *
 * Cached downstream in `springFromTiming`, so the bisection behind this is paid once
 * per distinct timing rather than once per call.
 */
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

export { springFromTiming, springDuration, spatialTiming, type Spring, type SpringTiming };
export { motionIsReduced } from '../utils/reducedMotion';