//! GSAP integration for physical springs.
//!
//! GSAP eases with bezier curves, which cannot represent a damped oscillator. This
//! module hands it the same closed-form spring the CSS `linear()` tokens are sampled
//! from, so a tween and a transition driven by the same token are the same motion —
//! no drift between the JS-driven and CSS-driven halves of the app.
//!
//! The curve travels as a plain **ease function** (`ratio -> eased ratio`), which is
//! GSAP's own extension point for exactly this, and the tween keeps the spring's real
//! settle time as its duration so GSAP's clock, `overwrite` and interrupt bookkeeping
//! behave.
//!
//! ## 为什么不写成 GSAP 插件
//!
//! 此前这里注册过一个名为 `springEase` 的自定义插件, 把求解塞进 `init` / `render`。
//! 它**从来没有运行过**: GSAP 只在 `vars` 的键名与已注册插件名一致时才会调用那个
//! 插件 —— `_initTween` 里是 `if (_plugins[p] && ...)` —— 而补间传的是 `spring:`。
//! 于是那份代码整段是死代码: `init` 不跑, `tween.duration()` 不改, 补间退回 GSAP 的
//! 默认 500ms 加 `ease: 'none'`, 也就是**匀速**。
//!
//! 这就是"不符合物理规律"的来源。`motion-spatial-plan.md` 把匀速明确列为待改项,
//! 而令牌层给的时长在 JS 这一半从未生效 —— 只有 CSS 那一半 (经 `easingTokens` 烘焙
//! 成 `linear()`) 是对的, 于是同一份令牌在两侧读起来是两回事。
//!
//! 改用 `ease` 函数顺带解决两件事: 不必再与 GSAP 自己的属性补间争夺同一批属性
//! (插件的 `render` 与 `_addPropTween` 会各写一遍), 也不再需要模块级的注册状态。

import { motionSpring, type MotionFamily, type MotionPhase } from './motionConfig';
import { motionIsReduced } from './reducedMotion';
import { springAtWithVelocity, springSettleTime, type Spring } from './spring';

/** GSAP 的 `ease` 接受一个 `ratio -> eased ratio` 的函数, 这就是弹簧的落位。 */
export type SpringEaseFunction = (ratio: number) => number;

/**
 * Tween vars for a spring.
 *
 * 只声明这里真正会产出的变量, 不铺开 GSAP 的整张表: `AnimationVars` 带有
 * `[key: string]: any`, 所以返回值天然可赋给 `gsap.TweenVars`, 而这份清单需要额外
 * 声明的只有弹簧自己的三个输入 —— 它们会被取走, 不会作为属性转发给 GSAP。
 */
export interface SpringTweenVars {
  /** 真实时长, 秒 —— 弹簧的沉降时间。GSAP 用它换算 ratio。 */
  duration?: number;
  delay?: number;
  /** 曲线。弹簧模式下它就是弹簧本身。 */
  ease?: SpringEaseFunction | string;
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

/**
 * The spring as a GSAP ease function over `[0, settle]`.
 *
 * `settle` is a parameter rather than recomputed because it is also the tween's
 * duration: GSAP divides elapsed time by the duration and hands the result here, so
 * the two must be the same number or the spring would be evaluated at the wrong
 * point in its own response.
 */
export function springEase(spring: Spring, settle: number, initialVelocity = 0): SpringEaseFunction {
  return (ratio: number) => springAtWithVelocity(spring, ratio * settle, initialVelocity);
}

/**
 * Tween vars for a spring, with reduced motion handled.
 *
 * `MotionPresence` and every FLIP transition go through here. `family` / `phase`
 * 只是缺省时序的来源: `extra.spring` 一旦给出就以它为准, 于是"按实测距离解算"这类
 * 调用不必先知道自己属于哪个家族。
 */
export function springTween<P extends Record<string, number | string>>(
  family: MotionFamily,
  phase: MotionPhase,
  properties: P,
  extra: SpringTweenVars = {}
): SpringTweenVars & P {
  const { spring, springDuration, initialVelocity, ...rest } = extra;
  if (motionIsReduced()) {
    return { ...properties, duration: 0, ease: 'none', ...rest };
  }
  const chosen = spring ?? motionSpring(family, phase);
  const settle = springDuration ?? springSettleTime(chosen);
  return {
    ...properties,
    duration: settle,
    ease: springEase(chosen, settle, initialVelocity ?? 0),
    ...rest,
  };
}