import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  MOTION_DISTANCE,
  motionDuration,
  MOTION_EASE,
  motionIsReduced,
  type MotionPresenceVariant,
} from './motionConfig';

gsap.registerPlugin(useGSAP);

export interface MotionPresenceProps extends HTMLAttributes<HTMLDivElement> {
  visible: boolean;
  variant?: MotionPresenceVariant;
  children: ReactNode;
  /** Optional external ref to the animated root (for positioning/measurement). */
  innerRef?: RefObject<HTMLDivElement | null>;
  onExitComplete?: () => void;
}

const ENTER: Record<MotionPresenceVariant, gsap.TweenVars> = {
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

const EXIT: Record<MotionPresenceVariant, gsap.TweenVars> = {
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

/**
 * Keeps a mounted child alive while its exit tween plays, then removes it.
 * This is the shared lifecycle primitive for floating windows, menus, and
 * dismissible surfaces; regular controls should stay on CSS transitions.
 */
export function MotionPresence({
  visible,
  variant = 'surface',
  children,
  className = '',
  innerRef,
  onExitComplete,
  ...props
}: MotionPresenceProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const [retained, setRetained] = useState(visible);
  const shouldRender = visible || retained;

  useEffect(() => {
    if (visible) setRetained(true);
  }, [visible]);

  useGSAP(
    () => {
      const element = ownRef.current;
      if (!element) return;

      if (visible) {
        if (motionIsReduced()) {
          gsap.set(element, { clearProps: 'transform,opacity' });
          return;
        }
        gsap.fromTo(
          element,
          ENTER[variant],
          {
            opacity: 1,
            x: 0,
            y: 0,
            scale: 1,
            duration: variant === 'overlay' ? motionDuration('quick') : motionDuration('base'),
            ease: MOTION_EASE.enter,
            clearProps: 'transform,opacity',
          }
        );
        return;
      }

      if (!retained || motionIsReduced()) {
        setRetained(false);
        onExitComplete?.();
        return;
      }

      gsap.to(element, {
        ...EXIT[variant],
        duration: variant === 'window' ? motionDuration('base') : motionDuration('quick'),
        ease: MOTION_EASE.exit,
        onComplete: () => {
          gsap.set(element, { clearProps: 'transform,opacity' });
          setRetained(false);
          onExitComplete?.();
        },
      });
    },
    {
      scope: ownRef,
      dependencies: [visible, retained, variant],
    }
  );

  if (!shouldRender) return null;

  return (
    <div
      {...props}
      ref={(node) => {
        ownRef.current = node;
        if (innerRef) innerRef.current = node;
      }}
      className={className}
      data-motion-variant={variant}
      data-motion-visible={visible ? 'true' : 'false'}
    >
      {children}
    </div>
  );
}
