//! presence 生命周期 —— "保活到退场播完"的唯一实现。
//!
//! 浮层要能退场, 元素就不能在 `open` 变假的那一刻被卸载。所以生命周期的形状是:
//! 声明 `visible`, 保活由本 hook 负责, 动画播完才回报可以移除。所有可关闭表面
//! (弹窗、菜单、气泡、提示条、浮动窗口) 共用这一份, 不各写一遍。
//!
//! **为什么不返回一个包一层的组件**: 包一层会让那层成为 Backdrop Root, 而
//! `backdrop-filter` 只采样到 Root 为止 —— 表面自己的磨砂会静默消失。所以这里
//! 只提供状态, 由调用方决定把它挂在哪一个元素上; 动画也必须作用在**表面自身**
//! 那个元素上, 与 `promote()` 的所有权一一对应。
//!
//! 两个渲染方共用本 hook:
//!   - `MotionPresence`: 表面由调用方自己写, 它只负责外包一层并转发生命周期;
//!   - `DialogSurface`: 表面就是它自己的 DOM, 于是直接内联, 不留额外节点。

import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createBorrowSlot, promote } from './compositor';
import { springTween } from './gsapSpring';
import { motionSpringFor, type MotionPresenceVariant } from './motionConfig';
import { motionIsReduced } from '../utils/reducedMotion';
import { exitVars, VARIANT_GEOMETRY, type TravelVector } from './presence';

export interface PresenceOptions {
  /** 目标状态。变假后元素仍会保留, 直到离场弹簧跑完。 */
  visible: boolean;
  variant?: MotionPresenceVariant;
  /** 离场播完且元素可以移除时调用一次。 */
  onExitComplete?: () => void;
  /**
   * 覆盖该角色的变换原点 —— 传入真实锚点 (停靠边、窗口生成的那个角),
   * 缩放就会从锚点长出来, 而不是从元素中心。
   */
  origin?: string;
  /** 用实测位移替换角色的名义进场偏移, 单位 px。 */
  travel?: TravelVector;
  /** 进场终点缩放。 */
  scale?: number;
  /**
   * 离场实际走多远, 单位 px。与 `travel` 不同, 这是位移本身而不是进场偏移的镜像:
   * 停靠面板朝它所属的那条边离开, 这不是任何名义角色值能知道的。不给就用角色
   * 自己的离场几何。
   */
  exitTravel?: TravelVector;
  /** 离场终点缩放, 原点同上。 */
  exitScale?: number;
}

/**
 * 驱动一个元素的进场/离场, 并回答"此刻还需要渲染吗"。
 *
 * 返回值在 `visible` 为真、或离场尚未播完时为 `true`。调用方应据此决定是否
 * 渲染 — 一旦为 `false`, 元素已经摆好终点姿态, 再留着只会挡住下面的界面。
 */
export function usePresence<T extends HTMLElement>(
  ref: RefObject<T | null>,
  {
    visible,
    variant = 'surface',
    onExitComplete,
    origin,
    travel,
    scale,
    exitTravel,
    exitScale,
  }: PresenceOptions
): boolean {
  const [retained, setRetained] = useState(visible);

  useEffect(() => {
    if (visible) setRetained(true);
  }, [visible]);

  // 在 effect 里读但不列为依赖: 调用方传的是对象字面量, 每次渲染都重跑会让弹簧重新起跳。
  const overrides = useRef({ origin, travel, scale, exitTravel, exitScale, onExitComplete });
  overrides.current = { origin, travel, scale, exitTravel, exitScale, onExitComplete };

  // 当前这一次动画对元素的借用。`useGSAP` 只在**卸载**时归还, 依赖变化时不会调用上一次
  // 返回的 cleanup —— 而进场/退场互相打断时补间是被 `killTweensOf` 杀掉的, `onComplete`
  // 根本不触发。于是上一段借的图层与 transform 所有权只能由下一段自己还回去, 否则
  // 它们会一直留在元素上。
  const borrow = useRef(createBorrowSlot());

  useGSAP(
    () => {
      const element = ref.current;
      if (!element) return;

      const geometry = VARIANT_GEOMETRY[variant];
      const from = overrides.current.travel ?? geometry.enterFrom;
      const enterScale = overrides.current.scale ?? geometry.enterScale;
      const transformOrigin = overrides.current.origin ?? geometry.origin;
      const distance = Math.hypot(from.x, from.y);

      // Re-entering mid-exit must reverse cleanly, so any in-flight tween dies
      // here rather than racing the new spring. 先还上一段的借用 —— killTweensOf
      // 不会替我们触发它的收尾。
      gsap.killTweensOf(element);
      borrow.current.release();

      if (motionIsReduced()) {
        // 关闭态**不能**把 opacity 交还给样式表: 遮罩的自然值是不透明, 于是在
        // 卸载前的那一帧整屏又暗下来, 低动画偏好用户看到的是"关掉时闪一下黑"。
        // 所以进场还原自然值, 退场显式压到 0。
        gsap.set(element, { clearProps: 'transform' });
        gsap.set(element, { opacity: visible ? 1 : 0 });
        if (!visible) {
          setRetained(false);
          overrides.current.onExitComplete?.();
        }
        return;
      }

      borrow.current.take(promote(element));
      // 收尾要清两样: 内联 transform/opacity, 以及借来的图层与所有权。
      // `will-change: opacity` 会让元素成为自己的 Backdrop Root, 自己的
      // backdrop-filter 只采样自身, 浮层磨砂随即静默消失 —— 所以不能只留 will-change。
      const settleEnter = () => {
        gsap.set(element, { clearProps: 'transform,opacity' });
        borrow.current.release();
      };
      // 退场收尾只归还 transform, opacity **必须**显式留在 0。
      //
      // 样式表里的自然值是不透明的 —— 遮罩是一整屏压暗层, 卡片是实心表面 —— 而卸载
      // 由调用方在一次新的 React 调度里提交, 与这段收尾之间夹着一帧完整渲染。把
      // opacity 一并交还样式表, 就是在那一帧把已经淡出的表面重新点亮: 用户看到的是
      // "关闭动画播完了, 又闪一下, 然后才消失"。低动画分支 (见下) 早就绕开了同一个
      // 坑 —— 那里写的是同一个判断 —— 这里补的是动画分支缺的同一份约束。
      const settleExit = () => {
        gsap.set(element, { clearProps: 'transform' });
        gsap.set(element, { opacity: 0 });
        borrow.current.release();
      };

      if (visible) {
        gsap.fromTo(
          element,
          {
            opacity: 0,
            x: from.x,
            y: from.y,
            scaleX: enterScale,
            scaleY: enterScale,
            transformOrigin,
          },
          {
            ...springTween(geometry.family, 'in', { opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1 }, {
              spring: motionSpringFor(geometry.family, 'in', distance),
            }),
            onComplete: settleEnter,
          }
        );
        return settleEnter;
      }

      if (!retained) {
        setRetained(false);
        overrides.current.onExitComplete?.();
        return settleExit;
      }

      const exit = exitVars(geometry, overrides.current.exitTravel, overrides.current.exitScale);
      // 离场按**它自己要走多远**拉伸, 不是复用进场那段位移: 停靠面板的进场偏移是
      // 28px, 退场只走 10px, 拿前者算会让一个更小的动作花掉更多时间。
      const exitDistance = overrides.current.exitTravel
        ? Math.hypot(overrides.current.exitTravel.x, overrides.current.exitTravel.y)
        : distance;
      gsap.to(element, {
        ...exit,
        transformOrigin,
        ...springTween(geometry.family, 'out', exit, {
          spring: motionSpringFor(geometry.family, 'out', exitDistance),
        }),
        onComplete: () => {
          settleExit();
          setRetained(false);
          overrides.current.onExitComplete?.();
        },
      });

      return settleExit;
    },
    { scope: ref, dependencies: [visible, retained, variant] }
  );

  return visible || retained;
}
