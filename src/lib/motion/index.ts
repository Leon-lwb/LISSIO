export {
  familyOf,
  motionDuration,
  motionSpeed,
  motionSpring,
  motionSpringFor,
  motionTiming,
  MOTION_DISTANCE,
  type MotionFamily,
  type MotionPhase,
  type MotionPresenceVariant,
  type MotionSpeed,
  type Spring,
  type SpringTiming,
} from './motionConfig';
export {
  motionIsReduced,
  setReducedMotionSetting,
  subscribeReducedMotion,
  syncReducedMotion,
  watchReducedMotion,
} from './reducedMotion';
export { installMotionTokens, springToLinearEasing } from './easingTokens';
export { ensureSpringPlugin, springTween, type SpringTweenVars } from './gsapSpring';
export { useDockReorder } from './dockFlip';
export { dockPanelGeometry, type DockEdge, type DockPanelGeometry } from './presence';
export { useMotionPresence } from './useMotionPresence';
export { MotionPresence, type MotionPresenceProps } from './MotionPresence';