export {
  familyOf,
  motionDuration,
  motionSpeed,
  motionSpring,
  motionSpringFor,
  motionTiming,
  reflowSpring,
  REFLOW_TIMING,
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
export { springEase, springTween, type SpringTweenVars } from './gsapSpring';
export { createBorrowSlot, promote, promotionCount, type BorrowSlot } from './compositor';
export {
  STAGGER_CAP_MS,
  STAGGER_STEP_MS,
  staggerDelayMs,
  useStaggerEntrance,
  type StaggerOptions,
} from './stagger';
export {
  GHOST_RELEASE_SCALE,
  GHOST_REST_OPACITY,
  MOMENTUM_FLOOR_PX_S,
  planRelease,
  type ReleasePlan,
} from './release';
export { useDockReorder } from './dockFlip';
export { useFlipReorder, type FlipReorderOptions } from './flipReorder';
export { dockPanelGeometry, type DockEdge, type DockPanelGeometry } from './presence';
export { useMotionPresence } from './useMotionPresence';
export { MotionPresence, type MotionPresenceProps } from './MotionPresence';