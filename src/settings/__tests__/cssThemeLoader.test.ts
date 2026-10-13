import { afterEach, describe, expect, it } from 'vitest';
import { getActiveCssThemeId, isCssThemeLoaded, loadCssTheme, unloadAllCssThemes } from '../css-theme-loader';
import type { CssStyleTheme } from '../theme';

const theme = (id: string, url = `/themes/${id}.css`): CssStyleTheme => ({ id, url, name: id, isBuiltIn: true });
const pending = () => document.head.querySelector<HTMLLinkElement>('link[id$="-pending"]')!;
function activate(id: string) {
  loadCssTheme(theme(id));
  const sheet = pending();
  sheet.dispatchEvent(new Event('load'));
  return sheet;
}
afterEach(unloadAllCssThemes);

describe('CSS theme handoff', () => {
  it('keeps the same sheet across repeated appearance updates and pending requests', () => {
    loadCssTheme(theme('default'));
    const link = pending();
    loadCssTheme(theme('default'));
    expect(pending()).toBe(link);
    link.dispatchEvent(new Event('load'));
    loadCssTheme(theme('default'));
    expect(document.getElementById('css-theme-default')).toBe(link);
    expect(document.head.querySelectorAll('link')).toHaveLength(1);
  });

  it('retains the active theme until the entire replacement stylesheet loads', () => {
    const old = activate('default');
    loadCssTheme(theme('monet'));
    const next = pending();
    expect(old.isConnected).toBe(true);
    expect(next.media).toBe('not all');
    expect(getActiveCssThemeId()).toBe('default');
    next.dispatchEvent(new Event('load'));
    expect(old.isConnected).toBe(false);
    expect(next.media).toBe('all');
    expect(isCssThemeLoaded('monet')).toBe(true);
  });

  it('keeps the old sheet after network failure and ignores a superseded load', () => {
    const old = activate('default');
    loadCssTheme(theme('failed'));
    pending().dispatchEvent(new Event('error'));
    expect(getActiveCssThemeId()).toBe('default');
    expect(old.isConnected).toBe(true);
    loadCssTheme(theme('monet'));
    const stale = pending();
    loadCssTheme(theme('custom'));
    stale.dispatchEvent(new Event('load'));
    expect(getActiveCssThemeId()).toBe('default');
    expect(stale.isConnected).toBe(false);
    pending().dispatchEvent(new Event('load'));
    expect(getActiveCssThemeId()).toBe('custom');
  });

  it('cancels a pending replacement when the active theme is requested again', () => {
    const old = activate('default');
    loadCssTheme(theme('monet'));
    const cancelled = pending();
    loadCssTheme(theme('default'));
    cancelled.dispatchEvent(new Event('load'));
    expect(getActiveCssThemeId()).toBe('default');
    expect(old.isConnected).toBe(true);
    expect(document.head.querySelectorAll('link')).toHaveLength(1);
  });

  it('reloads a changed URL for the same theme without an unstyled gap', () => {
    const old = activate('default');
    loadCssTheme(theme('default', '/themes/default.css?revision=2'));
    expect(old.isConnected).toBe(true);
    pending().dispatchEvent(new Event('load'));
    expect(old.isConnected).toBe(false);
    expect(isCssThemeLoaded('default')).toBe(true);
  });
});
