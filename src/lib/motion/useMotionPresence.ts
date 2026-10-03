import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import type { RefObject } from 'react';
import {
  MOTION_DISTANCE,
  motionDuration,
  MOTION_EASE,
  motionIsReduced,
  type MotionPresenceVariant,
} from './motionConfig';

gsap.registerPlugin(useGSAP);

interface MotionPresenceOptions {
  variant?: MotionPresenceVariant;
  delay?: number;
  enabled?: boolean;
}

const FROM: Record<MotionPresenceVariant, gsap.TweenVars> = {
  overlay: { opacity: 0 },
  surface: { opacity: 0, y: MOTION_DISTANCE.micro, scale: 0.99 },
  popover: { opacity: 0, y: -MOTION_DISTANCE.micro, scale: 0.985 },
  toast: { opacity: 0, x: MOTION_DISTANCE.small, scale: 0.99 },
  panel: { opacity: 0, x: MOTION_DISTANCE.panel, scale: 0.99 },
  row: { opacity: 0, y: -MOTION_DISTANCE.micro },
  message: { opacity: 0, y: MOTION_DISTANCE.micro },
  window: { opacity: 0, y: MOTION_DISTANCE.panel, scale: 0.97 },
  menu: { opacity: 0, y: -MOTION_DISTANCE.micro, scale: 0.985 },
  banner: { opacity: 0, y: -MOTION_DISTANCE.micro },
};

const TO: Record<MotionPresenceVariant, gsap.TweenVars> = {
  overlay: { opacity: 1 },
  surface: { opacity: 1, y: 0, scale: 1 },
  popover: { opacity: 1, y: 0, scale: 1 },
  toast: { opacity: 1, x: 0, scale: 1 },
  panel: { opacity: 1, x: 0, scale: 1 },
  row: { opacity: 1, y: 0 },
  message: { opacity: 1, y: 0 },
  window: { opacity: 1, y: 0, scale: 1 },
  menu: { opacity: 1, y: 0, scale: 1 },
  banner: { opacity: 1, y: 0 },
};

/** Plays a restrained entrance once; use MotionPresence for dismissible surfaces. */
export function useMotionPresence<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { variant = 'surface', delay = 0, enabled = true }: MotionPresenceOptions = {}
): void {
  useGSAP(
    () => {
      const element = ref.current;
      if (!element || !enabled || motionIsReduced()) return;

      gsap.fromTo(
        element,
        FROM[variant],
        {
          ...TO[variant],
          duration: variant === 'overlay' ? motionDuration('quick') : motionDuration('base'),
          delay,
          ease: MOTION_EASE.enter,
          clearProps: 'transform,opacity',
        }
      );
    },
    { scope: ref, dependencies: [variant, delay, enabled] }
  );
}
