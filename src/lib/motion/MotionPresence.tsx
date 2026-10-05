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
import { createBorrowSlot, promote } from './compositor';
import { springTween } from './gsapSpring';
import { motionSpeed, motionSpringFor, type MotionPresenceVariant } from './motionConfig';
import { motionIsReduced } from './reducedMotion';
import { exitVars, VARIANT_GEOMETRY, type TravelVector } from './presence';

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
  /**
   * Where the surface actually goes on its way out, in px. Unlike `travel` this
   * is the displacement itself, not a mirror of the entrance offset: a docked
   * panel leaves toward the edge it belongs to, which no nominal role value can
   * know. Omit it and the role's own exit geometry applies.
   */
  exitTravel?: TravelVector;
  /** Scale applied at the exit's far end, about the same origin. */
  exitScale?: number;
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
  exitTravel,
  exitScale,
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
  const overrides = useRef({ origin, travel, scale, exitTravel, exitScale });
  overrides.current = { origin, travel, scale, exitTravel, exitScale };

  // 当前这一次动画对元素的借用。`useGSAP` 只在**卸载**时归还, 依赖变化时不会调用上一次
  // 返回的 cleanup —— 而进场/退场互相打断时补间是被 `killTweensOf` 杀掉的, `onComplete`
  // 根本不触发。于是上一段借的图层与 transform 所有权只能由下一段自己还回去, 否则
  // 它们会一直留在元素上。
  const borrow = useRef(createBorrowSlot());

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
      // here rather than racing the new spring. 先还上一段的借用 —— killTweensOf
      // 不会替我们触发它的收尾。
      gsap.killTweensOf(element);
      borrow.current.release();

      if (motionIsReduced()) {
        gsap.set(element, { clearProps: 'transform,opacity' });
        if (!visible) {
          setRetained(false);
          onExitComplete?.();
        }
        return;
      }

      borrow.current.take(promote(element));
      // 收尾要清两样: 内联 transform/opacity, 以及借来的图层与所有权。
      // `will-change: opacity` 会让元素成为自己的 Backdrop Root, 自己的
      // backdrop-filter 只采样自身, 浮层磨砂随即静默消失 —— 所以不能只留 will-change。
      const settle = () => {
        gsap.set(element, { clearProps: 'transform,opacity' });
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