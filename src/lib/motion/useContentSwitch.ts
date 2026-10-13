import { useLayoutEffect, useRef, type RefObject } from 'react';
import { motionDuration } from './motionConfig';
import { motionIsReduced, subscribeReducedMotion } from '../utils/reducedMotion';

/** Move content without making a temporary opacity Backdrop Root around frosted children. */
export function useContentSwitch(
  ref: RefObject<HTMLElement | null>,
  key: string,
  resolveTravel: (previous: string) => { x: number; y: number }
): void {
  const previous = useRef(key);
  const travel = useRef(resolveTravel);
  travel.current = resolveTravel;

  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = key;
    const element = ref.current;
    if (!element || from === key || motionIsReduced() || typeof element.animate !== 'function') return;
    const { x, y } = travel.current(from);
    if (x === 0 && y === 0) return;
    const easing = getComputedStyle(element).getPropertyValue('--ease-content-in').trim();
    const animation = element.animate([
      { transform: `translate(${x}px, ${y}px)` },
      { transform: 'none' },
    ], { duration: motionDuration('content', 'in') * 1000, easing });
    // Completion is owned by the animation engine, rather than a timer clearing
    // styles a frame before/after the transition. Inline styles stay untouched.
    void animation.finished.then(() => animation.cancel(), () => undefined);
    const unsubscribe = subscribeReducedMotion(() => {
      if (motionIsReduced()) animation.cancel();
    });
    return () => { unsubscribe(); animation.cancel(); };
  }, [key, ref]);
}
