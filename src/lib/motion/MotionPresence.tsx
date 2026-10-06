import { useRef, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { motionSpeed, type MotionPresenceVariant } from './motionConfig';
import type { TravelVector } from './presence';
import { usePresence } from './usePresence';

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
 * This is the shared lifecycle primitive for menus, toasts and floating windows —
 * surfaces whose own root element must stay a plain wrapper. A dialog goes through
 * `DialogSurface` instead: it animates its own DOM, so it needs no wrapper, and a
 * wrapper would cut its `backdrop-filter` off from the page behind it.
 *
 * Geometry comes from the presence role, timing from the motion family, and the
 * spring is solved for the real travel distance so a long crossing is not read at
 * the pace of a short one.
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
  const shouldRender = usePresence(ownRef, {
    visible,
    variant,
    onExitComplete,
    origin,
    travel,
    scale,
    exitTravel,
    exitScale,
  });

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
