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
import { promote } from './compositor';
import { ensureSpringPlugin, springTween } from './gsapSpring';
import { motionSpeed, motionSpringFor, type MotionPresenceVariant } from './motionConfig';
import { motionIsReduced } from './reducedMotion';
import { travelVars, VARIANT_GEOMETRY, type TravelVector } from './presence';

ensureSpringPlugin();

export interface MotionPresenceProps extends HTMLAttributes<HTMLDivElement> {
  visible: boolean;
  variant?: MotionPresenceVariant;
  children: ReactNode;
  /** Optional external ref to the animated root (for positioning/measurement). */
  innerRef?: RefObject<HTMLDivElement | null>;
  onExitComplete?: () => void;
  /**
   * Overrides the variant's transform origin — pass the real anchor (a dock
   * edge, the corner a window spawned from) so scaling grows out of it instead
   * of out of the element's centre.
   */
  origin?: string;
  /**
   * Replaces the variant's nominal travel with a measured one, in px. Used when
   * the surface is arriving from a known place rather than a fixed offset.
   */
  travel?: TravelVector;
  /** Scale applied at the entrance's far end. */
  scale?: number;
}

/**
 * Keeps a mounted child alive while its exit plays, then removes it.
 *
 * This is the shared lifecycle primitive for dialogs, menus, toasts and floating
 * windows. Geometry comes from the presence role, timing from the motion family,
 * and the spring is solved for the real travel distance so a long crossing is
 * not read at the pace of a short one.
 *
 * Regular controls should stay on CSS transitions — this component exists for
 * surfaces that need a retained mount and an exit-complete callback.
 */
export function MotionPresence({
  visible,
  variant = 'surface',
  children,
  className = '',
  innerRef,
  onExitComplete,
  origin,
  travel,
  scale,
  ...props
}: MotionPresenceProps) {
  const ownRef = useRef<HTMLDivElement>(null);
  const [retained, setRetained] = useState(visible);
  const shouldRender = visible || retained;

  useEffect(() => {
    if (visible) setRetained(true);
  }, [visible]);

  // Read inside the effect without making it a dependency: callers pass object
  // literals, and re-running the tween on every render would restart the spring.
  const overrides = useRef({ origin, travel, scale });
  overrides.current = { origin, travel, scale };

  useGSAP(
    () => {
      const element = ownRef.current;
      if (!element) return;

      const geometry = VARIANT_GEOMETRY[variant];
      const from = overrides.current.travel ?? geometry.enterFrom;
      const enterScale = overrides.current.scale ?? geometry.enterScale;
      const transformOrigin = overrides.current.origin ?? geometry.origin;
      const distance = Math.hypot(from.x, from.y);

      // Re-entering mid-exit must reverse cleanly, so any in-flight tween dies
      // here rather than racing the new spring.
      gsap.killTweensOf(element);

      if (motionIsReduced()) {
        gsap.set(element, { clearProps: 'transform,opacity' });
        if (!visible) {
          setRetained(false);
          onExitComplete?.();
        }
        return;
      }

      const release = promote(element);
      // 同 useMotionPresence: 收尾必须由 cleanup 兜底, 因为 context revert 杀 tween
      // 时不触发 onComplete —— StrictMode 的第一次 effect 会留下一份永不归还的
      // will-change, 而 will-change: opacity 会让该元素成为自己的 Backdrop Root,
      // 自己的 backdrop-filter 只采样自身, 浮层磨砂随即静默消失。
      const settle = () => {
        gsap.set(element, { clearProps: 'transform,opacity' });
        release();
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
            onComplete: settle,
          }
        );
        return settle;
      }

      if (!retained) {
        setRetained(false);
        onExitComplete?.();
        return settle;
      }

      const exit = travelVars(geometry, 'exit');
      gsap.to(element, {
        ...exit,
        transformOrigin,
        ...springTween(geometry.family, 'out', exit, {
          spring: motionSpringFor(geometry.family, 'out', distance),
        }),
        onComplete: () => {
          settle();
          setRetained(false);
          onExitComplete?.();
        },
      });

      return settle;
    },
    { scope: ownRef, dependencies: [visible, retained, variant] }
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
      data-motion-speed={motionSpeed()}
    >
      {children}
    </div>
  );
}