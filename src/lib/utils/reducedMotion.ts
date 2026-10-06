//! 低动画偏好的唯一权威源 (实现层)。
//!
//! 两个输入 —— 系统 `prefers-reduced-motion` 媒体查询与应用内外观设置 —— 都汇入
//! `<html>` 上的同一个类, 那是唯一被读取的东西: JS 问 `motionIsReduced()`, CSS 认
//! `.reduced-motion`。新增动画面不可能读错。
//!
//! 判定属于实现层而不是效果层: 它是"用户要什么"的策略, 不含任何动画实现 ——
//! 手势 (拖拽、滚动跟随) 与异步动作同样要在低动画下走无动画分支, 却不属于效果层。
//! 判定若住在效果层, 这些调用点只能反向依赖效果层, 范式方向即被破坏。
//! 效果层经 `lib/motion` 转发读取 (见 `motion/index.ts`), 调用方写法不变。

const MEDIA_QUERY = '(prefers-reduced-motion: reduce)';

/** Set by `applyTheme()` from the in-app appearance setting. */
const SETTING_ATTRIBUTE = 'data-reduced-motion';

const subscribers = new Set<() => void>();
let listening = false;

/**
 * Whether the *system* asks for reduced motion.
 *
 * Environments without `matchMedia` (jsdom, some embedded webviews) are treated
 * as reduced: skipping animation is the safe failure mode, and it keeps tests
 * deterministic without stubbing the media query.
 */
function systemPrefersReduced(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(MEDIA_QUERY).matches;
}

function settingPrefersReduced(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute(SETTING_ATTRIBUTE) === 'true';
}

function emit(): void {
  subscribers.forEach((fn) => fn());
}

/** Recompute the root class from the media query plus the in-app setting. */
export function syncReducedMotion(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle(
    'reduced-motion',
    systemPrefersReduced() || settingPrefersReduced()
  );
  emit();
}

/**
 * Start mirroring OS-level changes onto the root class. Idempotent, and safe to
 * call before React mounts.
 */
export function watchReducedMotion(): void {
  if (listening || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return;
  }
  listening = true;
  const media = window.matchMedia(MEDIA_QUERY);
  const onChange = () => syncReducedMotion();
  if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange);
  else if (typeof media.addListener === 'function') media.addListener(onChange);
  syncReducedMotion();
}

/**
 * The one predicate every animated surface must consult before it moves.
 * Reads the resolved root class so it stays consistent with the CSS layer.
 */
export function motionIsReduced(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.documentElement.classList.contains('reduced-motion')) return true;
  return systemPrefersReduced();
}

/** Record the in-app appearance setting and re-resolve the root class. */
export function setReducedMotionSetting(enabled: boolean): void {
  if (typeof document === 'undefined') return;
  if (enabled) document.documentElement.setAttribute(SETTING_ATTRIBUTE, 'true');
  else document.documentElement.removeAttribute(SETTING_ATTRIBUTE);
  syncReducedMotion();
}

/** Observe reduced-motion changes (e.g. to pause idle loops). Returns an unsubscribe. */
export function subscribeReducedMotion(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}