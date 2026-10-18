import { describe, expect, it } from 'vitest';

import { findMotionWrites } from './check-ui-layers.mjs';

/**
 * Self-test for the L7 compositing-layer property scan.
 *
 * The comment above the table in `check-ui-layers.mjs` documented three forms —
 * assignment, object literal, and `setProperty('will-change', …)` string
 * argument — but the regexes required `:` or `=` directly after the name, so the
 * string-argument form (and bracket access) were never matched. These fixtures
 * pin every documented spelling.
 */
describe('forbidden will-change / transition-property writes', () => {
  it.each([
    ['assignment', "el.style.willChange = 'transform';"],
    ['object literal', "const style = { willChange: 'transform' };"],
    ['setProperty string argument', "el.style.setProperty('will-change', 'transform');"],
    ['setProperty with a double-quoted name', 'el.style.setProperty("will-change", "transform");'],
    ['bracket assignment', "el.style['will-change'] = 'transform';"],
    ['quoted object key', "const style = { 'willChange': 'transform' };"],
  ])('reports the %s form', (_, source) => {
    expect(findMotionWrites(source).map((entry) => entry.name)).toEqual(['will-change / willChange']);
  });

  it.each([
    ['assignment', "el.style.transitionProperty = 'width 200ms ease';"],
    ['object literal', "const style = { transitionProperty: 'width 200ms ease' };"],
    ['setProperty string argument', "el.style.setProperty('transition-property', 'width 200ms');"],
    ['bracket assignment', "el.style['transition-property'] = 'width 200ms';"],
  ])('reports the transition-property %s form', (_, source) => {
    expect(findMotionWrites(source).map((entry) => entry.name)).toEqual(['transition-property / transitionProperty']);
  });

  it('does not report paint-layer properties', () => {
    expect(findMotionWrites("el.style.opacity = '0.5'; el.style.transform = 'translateX(4px)';")).toEqual([]);
    expect(findMotionWrites("const classes = 'will-change-transform';")).toEqual([]);
  });
});
