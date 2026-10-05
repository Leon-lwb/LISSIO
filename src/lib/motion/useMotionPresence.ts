import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef, type RefObject } from 'react';
import { createBorrowSlot, promote } from './compositor';
import { springTween } from './gsapSpring';
import { motionSpringFor, type MotionPresenceVariant } from './motionConfig';
import { motionIsReduced } from './reducedMotion';
import { VARIANT_GEOMETRY } from './presence';

interface MotionPresenceOptions {
  variant?: MotionPresenceVariant;
  delay?: number;
  enabled?: boolean;
  origin?: string;
}

/**
 * Plays a spring-driven entrance once, without the exit half.
 *
 * Use `MotionPresence` for dismissible surfaces. This hook exists for surfaces
 * whose exit is handled by the DOM — a `<details>` disclosure, a route change, a
 * dialog whose parent unmounts — where there is nothing to keep alive.
 */
export function useMotionPresence<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { variant = 'surface', delay = 0, enabled = true, origin }: MotionPresenceOptions = {}
): void {
  const overrides = useRef({ origin });
  overrides.current = { origin };

  // 见 `BorrowSlot`: `useGSAP` 只在卸载时归还, 依赖变化时不会调用上一次返回的
  // cleanup, 而打断就是靠 `killTweensOf` 收场的 —— 那一层只能由新一段自己还。
  const borrow = useRef(createBorrowSlot());

  useGSAP(
    () => {
      const element = ref.current;
      if (!element || !enabled) return;

      const geometry = VARIANT_GEOMETRY[variant];
      const transformOrigin = overrides.current.origin ?? geometry.origin;

      gsap.killTweensOf(element);
      borrow.current.release();
      if (motionIsReduced()) {
        gsap.set(element, { clearProps: 'transform,opacity' });
        return;
      }

      borrow.current.take(promote(element));
      const settle = () => {
        gsap.set(element, { clearProps: 'transform,opacity' });
        borrow.current.release();
      };

      if (!geometry.displaces) {
        gsap.fromTo(
          element,
          { opacity: 0 },
          {
            opacity: 1,
            duration: 0.001,
            delay,
            onComplete: settle,
          }
        );
        return settle;
      }

      const distance = Math.hypot(geometry.enterFrom.x, geometry.enterFrom.y);
      gsap.fromTo(
        element,
        {
          opacity: 0,
          x: geometry.enterFrom.x,
          y: geometry.enterFrom.y,
          scaleX: geometry.enterScale,
          scaleY: geometry.enterScale,
          transformOrigin,
        },
        {
          // 目标值只在这里写一次: 时长与曲线由 springTween 补上, 与 MotionPresence
          // 的进场走同一条路。
          ...springTween(
            geometry.family,
            'in',
            { opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1 },
            { spring: motionSpringFor(geometry.family, 'in', distance), delay }
          ),
          onComplete: settle,
        }
      );
      return settle;
    },
    { scope: ref, dependencies: [variant, delay, enabled] }
  );
}