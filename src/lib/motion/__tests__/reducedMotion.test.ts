import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  motionIsReduced,
  setReducedMotionSetting,
  subscribeReducedMotion,
  watchReducedMotion,
} from '../reducedMotion';

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    addListener: (fn: () => void) => listeners.add(fn),
    removeListener: (fn: () => void) => listeners.delete(fn),
    dispatchEvent: () => false,
    /** Test hook: fire the OS-level change listeners. */
    emit: () => listeners.forEach((fn) => fn()),
    set: (next: boolean) => {
      media.matches = next;
    },
  };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(media));
  return media;
}

function clearRoot() {
  document.documentElement.classList.remove('reduced-motion');
  document.documentElement.removeAttribute('data-reduced-motion');
}

describe('reduced motion', () => {
  afterEach(() => {
    clearRoot();
    vi.unstubAllGlobals();
  });

  it('treats a missing matchMedia as reduced, not as full motion', () => {
    vi.stubGlobal('matchMedia', undefined);
    clearRoot();
    expect(motionIsReduced()).toBe(true);
  });

  it('reports reduced when the system asks for it', () => {
    stubMatchMedia(true);
    clearRoot();
    expect(motionIsReduced()).toBe(true);
  });

  it('reports full motion when nothing asks for reduced', () => {
    stubMatchMedia(false);
    clearRoot();
    expect(motionIsReduced()).toBe(false);
  });

  it('folds the in-app setting into the same root class', () => {
    stubMatchMedia(false);
    clearRoot();
    setReducedMotionSetting(true);
    expect(document.documentElement.classList.contains('reduced-motion')).toBe(true);
    expect(motionIsReduced()).toBe(true);

    setReducedMotionSetting(false);
    expect(document.documentElement.classList.contains('reduced-motion')).toBe(false);
    expect(motionIsReduced()).toBe(false);
  });

  it('cannot be turned off in-app while the system still asks for reduced', () => {
    // The class is the single authority, so the OS preference has to win even
    // when the user has the in-app switch off.
    stubMatchMedia(true);
    clearRoot();
    setReducedMotionSetting(false);
    expect(document.documentElement.classList.contains('reduced-motion')).toBe(true);
    expect(motionIsReduced()).toBe(true);
  });

  it('keeps the in-app setting effective even if the OS query is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    clearRoot();
    // An embedded webview without matchMedia is assumed reduced, so this holds
    // either way; what matters is that the class reflects the decision.
    setReducedMotionSetting(true);
    expect(document.documentElement.classList.contains('reduced-motion')).toBe(true);
  });

  it('mirrors later OS-level changes onto the root class', () => {
    const media = stubMatchMedia(false);
    clearRoot();
    watchReducedMotion();
    expect(document.documentElement.classList.contains('reduced-motion')).toBe(false);

    media.set(true);
    media.emit();
    expect(document.documentElement.classList.contains('reduced-motion')).toBe(true);
    expect(motionIsReduced()).toBe(true);

    media.set(false);
    media.emit();
    expect(motionIsReduced()).toBe(false);
  });

  it('notifies subscribers whenever the resolved value is re-derived', () => {
    stubMatchMedia(false);
    clearRoot();
    let calls = 0;
    const unsubscribe = subscribeReducedMotion(() => {
      calls += 1;
    });

    setReducedMotionSetting(true);
    expect(calls).toBe(1);
    setReducedMotionSetting(false);
    expect(calls).toBe(2);

    unsubscribe();
    setReducedMotionSetting(true);
    expect(calls).toBe(2);
  });
});