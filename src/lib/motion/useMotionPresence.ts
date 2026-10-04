import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { useRef, type RefObject } from 'react';
import { promote } from './compositor';
import { ensureSpringPlugin, springTween } from './gsapSpring';
import { motionSpringFor, type MotionPresenceVariant } from './motionConfig';
import { motionIsReduced } from './reducedMotion';
import { VARIANT_GEOMETRY } from './presence';

ensureSpringPlugin();

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

  useGSAP(
    () => {
      const element = ref.current;
      if (!element || !enabled) return;

      const geometry = VARIANT_GEOMETRY[variant];
      const transformOrigin = overrides.current.origin ?? geometry.origin;

      gsap.killTweensOf(element);
      if (motionIsReduced()) {
        gsap.set(element, { clearProps: 'transform,opacity' });
        return;
      }

      const release = promote(element);
      if (!geometry.displaces) {
        gsap.fromTo(
          element,
          { opacity: 0 },
          {
            opacity: 1,
            duration: 0.001,
            delay,
            onComplete: release,
          }
        );
        return;
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
          opacity: 1,
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          ...springTween(geometry.family, 'in', { opacity: 1 }, {
            spring: motionSpringFor(geometry.family, 'in', distance),
            delay,
          }),
          onComplete: () => {
            gsap.set(element, { clearProps: 'transform,opacity' });
            release();
          },
        }
      );
    },
    { scope: ref, dependencies: [variant, delay, enabled] }
  );
}