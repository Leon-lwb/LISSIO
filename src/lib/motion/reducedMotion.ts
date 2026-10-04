//! Single authority for reduced-motion.
//!
//! Three inputs exist — the OS `prefers-reduced-motion` media query and the
//! in-app appearance setting — and previously each call site checked whichever it
//! happened to know about, so behaviour drifted between a CSS `!important`
//! blanket rule, a component-local `matchMedia` call, and the shared hook.
//!
//! Now both inputs funnel into one class on `<html>`, which is the only thing
//! anyone reads: JavaScript asks `motionIsReduced()`, CSS keys off
//! `.reduced-motion`. Adding a new animated surface cannot get this wrong.

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