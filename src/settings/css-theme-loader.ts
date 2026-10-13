//! CSS theme loading: retain the active sheet until its replacement has loaded.

import type { CssStyleTheme } from './theme';

interface ThemeSheet {
  id: string;
  url: string;
  link: HTMLLinkElement;
}

let active: ThemeSheet | null = null;
let pending: ThemeSheet | null = null;

export function loadCssTheme(theme: CssStyleTheme): void {
  const url = new URL(theme.url, document.baseURI).href;
  if (pending?.id === theme.id && pending.url === url) return;
  pending?.link.remove();
  pending = null;
  if (active?.id === theme.id && active.url === url && active.link.isConnected) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.id = `css-theme-${theme.id}-pending`;
  // Fetch without partially applying the new theme before the atomic handoff.
  link.media = 'not all';
  const sheet = { id: theme.id, url, link };
  pending = sheet;
  link.onload = () => {
    if (pending !== sheet) return;
    link.media = 'all';
    active?.link.remove();
    link.id = `css-theme-${theme.id}`;
    active = sheet;
    pending = null;
  };
  link.onerror = () => {
    if (pending !== sheet) return;
    link.remove();
    pending = null;
  };
  document.head.appendChild(link);
}

export function unloadCssTheme(themeId: string): void {
  if (pending?.id === themeId) { pending.link.remove(); pending = null; }
  if (active?.id === themeId) { active.link.remove(); active = null; }
}

export function unloadAllCssThemes(): void {
  pending?.link.remove();
  active?.link.remove();
  pending = active = null;
}

export function getActiveCssThemeId(): string | null {
  return active?.id ?? null;
}

export function isCssThemeLoaded(themeId: string): boolean {
  return active?.id === themeId && active.link.isConnected;
}
