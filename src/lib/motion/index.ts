export {
  familyOf,
  motionDuration,
  motionSpeed,
  motionSpring,
  motionSpringFor,
  motionTiming,
  reflowSpring,
  REFLOW_TIMING,
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
} from '../utils/reducedMotion';
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
// 浮层几何令牌的读写点: presence.ts 是数值来源, easingTokens.ts 把它投影到 <html>。
export {
  VARIANT_GEOMETRY,
  cssScaleToken,
  cssScaleValue,
  cssTravelToken,
  cssTravelValue,
  type TravelVector,
  type VariantGeometry,
} from './presence';
export { useMotionPresence } from './useMotionPresence';
export { usePresence, type PresenceOptions } from './usePresence';
export { RetentionScope } from './RetentionScope';
export { useRetention, useExitSnapshot } from './retention';
export { MotionPresence, type MotionPresenceProps } from './MotionPresence';
