#!/usr/bin/env node
// Motion property gate — turns "animation must stay on the compositor/paint layer" from prose
// into a CI check. Usage: pnpm check:motion
//
// Why this gate exists:
//
//   1. The frontend performance probe cannot see layout transitions. The per-frame flex reflow
//      caused by `transition: flex-grow` happens in browser C++ without going through any JS, so
//      main-thread counters like setAttribute / getBoundingClientRect are completely blind to it
//      (see docs/performance/frontend-render-budget.md). In other words: a green performance gate
//      does not mean there is no per-frame layout.
//   2. This kind of defect looks like one harmless line of code, shows no cost in review, and
//      turns no existing test red. Only making "which properties may transition" an executable
//      whitelist can prevent regressions.
//
// Scope (all three forms must be covered, because Tailwind arbitrary values can bypass a pure CSS
// scan):
//   - `transition` / `transition-property` declarations in src/**/*.css
//   - properties inside `@keyframes` in src/**/*.css
//   - `transition-[...]` / `transition-all` utility classes and inline `transition` /
//     `transitionProperty` in src/**/*.{ts,tsx}
//
// Exemptions: see the EXEMPTIONS table below. Exemptions are public and state their reason one by
// one; adding one admits a deliberate exception that stays visible in review; anything
// unregistered is an error.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const SRC = path.join(root, 'src');
const errors = [];

/**
 * Properties allowed in transitions / keyframes: all of them trigger only paint or compositing
 * and never make the browser re-layout.
 *
 * The test is "does changing this property make the browser reflow", not "does it look
 * expensive" — the latter cannot be checked. `background` goes through shorthand interpolation:
 * this repository only uses it on solid-color backgrounds without background-image, which is
 * paint-layer; once it is given a gradient, this exemption should be withdrawn.
 */
const COMPOSITOR_SAFE = new Set([
  'transform',
  'opacity',
  'visibility',
  'filter',
  'backdrop-filter',
  '-webkit-backdrop-filter',
  'color',
  'fill',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'background',
  'background-color',
  'background-image',
  'border-color',
  'border-style',
  'border-image',
  'outline-color',
  'outline-style',
  'box-shadow',
  'text-shadow',
  'text-decoration-color',
  'caret-color',
  'accent-color',
  'column-rule-color',
]);

/** Time values and easing keywords: not property names when they appear in a transition value. */
const TIMING_KEYWORDS = new Set([
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
  'allow-discrete',
]);

/**
 * Deliberate exceptions. Each must answer both: what it is, and why the per-frame layout here is
 * bounded.
 *
 * This table is the complete list of "allowed to animate on the layout layer" — it should be
 * short. If it grows, the animation approach should change, not the exemptions.
 *
 * `clip-path` is neither in the whitelist nor here: it is itself a paint-layer property, but
 * applied to an **ancestor** it silently disables the backdrop-filter of descendants (the
 * element becomes its own Backdrop Root). That constraint can only be expressed by "scoping to a
 * specific file"; allowing it repository-wide would hang the key to this line of defense on the
 * doorknob.
 */
const EXEMPTIONS = [
  {
    file: 'src/components/onboarding/TourSpotlight.tsx',
    properties: /^(?:left|top|width|height|x|y)$/,
    reason: 'Onboarding tour spotlight: a single childless fixed overlay box, so per-frame layout affects only this one empty box, and only while the tour is open. It must follow an arbitrary DOM rectangle and has no equivalent transform expression.',
  },
  {
    file: 'src/components/widgets/progress/ProgressBarWidget.tsx',
    properties: /^clip-path$/,
    reason: 'Full-size fill block + clip-path clipping the ratio: a paint-layer property, and it is itself the path that replaces a width/height transition. Scoped to this file — it sits inside the widget card, not under any backdrop-filter surface.',
  },
  {
    file: 'src/components/NotificationToasts.tsx',
    properties: /^max-height$/,
    reason: 'Expanding/collapsing a message expresses a change in the **number of wrapped text lines**, and wrapping can only be computed by layout; transform cannot change the box height, and scaleY would squash the text. The per-frame reflow here is limited to a max-height 4.5em notification body and only runs on user click.',
  },
];

/** Recursively collect files under src with the given extensions (skipping generated output). */
function collect(dir, extensions, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'generated') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(p, extensions, out);
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(p);
  }
  return out;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

/** Split on top-level commas — a comma inside a function is not a separator. */
function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let buffer = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(buffer);
      buffer = '';
      continue;
    }
    buffer += ch;
  }
  parts.push(buffer);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Extract the property name from a transition value.
 *
 * Skip time, multiplier, easing keywords, and functions (var/cubic-bezier/steps) token by token;
 * the first bare identifier that remains is the property name — exactly the syntactic position of
 * the CSS transition shorthand. A custom property is returned as-is and left to the caller to
 * report: an unregistered custom property cannot transition at all, so writing it is as good as
 * not writing it.
 */
function propertyOf(part) {
  for (const token of part.split(/\s+/)) {
    if (!token || token === '!important') continue;
    if (/^-?[\d.]+(?:m?s)?$/.test(token)) continue;
    if (token.startsWith('--')) return token;
    if (/^[a-z-]+\(/i.test(token)) continue;
    if (TIMING_KEYWORDS.has(token.toLowerCase())) continue;
    return token;
  }
  return null;
}

function isExempt(file, property) {
  return EXEMPTIONS.some(
    (entry) => entry.file === relative(file) && entry.properties.test(property)
  );
}

function report(file, line, property, why) {
  errors.push(`${relative(file)}:${line}  ${property} — ${why}`);
}

/** Strip block comments and whole-line comments but preserve line counts, so line numbers stay usable. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*(?:\/\/|\/\*|\*)/.test(line) ? '' : line))
    .join('\n');
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

// ---------- CSS ----------

/** Extract the name and body of every @keyframes and remove them from the source to avoid rescanning. */
function extractKeyframes(css) {
  const blocks = [];
  const pattern = /@keyframes\s+([\w-]+)\s*\{/g;
  let match = pattern.exec(css);
  while (match !== null) {
    let depth = 1;
    let cursor = pattern.lastIndex;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1;
      else if (css[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    blocks.push({
      name: match[1],
      offset: pattern.lastIndex,
      body: css.slice(pattern.lastIndex, cursor - 1),
    });
    pattern.lastIndex = cursor;
    match = pattern.exec(css);
  }
  const stripped = css.replace(/@keyframes\s+[\w-]+\s*\{[\s\S]*?\n\}/g, (block) =>
    block.replace(/[^\n]/g, ' ')
  );
  return { blocks, stripped };
}

function checkCss(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const css = stripComments(raw);
  const { blocks, stripped } = extractKeyframes(css);

  if (blocks.length === 0 && !/transition/.test(css) && !/--motion-(?:travel|scale)-/.test(css)) return;

  // Properties inside @keyframes frames
  for (const block of blocks) {
    for (const match of block.body.matchAll(/(?:^|[;{])\s*([a-zA-Z-]+)\s*:/g)) {
      const property = match[1];
      if (COMPOSITOR_SAFE.has(property) || isExempt(file, property)) continue;
      report(file, lineOf(css, block.offset + match.index), property, 'only paint-layer properties may be interpolated inside @keyframes');
    }
  }

  checkGeometryTokens(file, css);

  // transition / transition-property declarations
  for (const match of stripped.matchAll(/(?:^|[;{])\s*(transition(?:-property)?)\s*:\s*([^;]+)/g)) {
    const declarationStart = match.index + match[0].indexOf(match[2]);
    for (const part of splitTopLevel(match[2])) {
      if (part === 'none' || part === 'initial' || part === 'unset') continue;
      const property = propertyOf(part);
      if (property === null) continue;
      if (COMPOSITOR_SAFE.has(property) || isExempt(file, property)) continue;
      report(
        file,
        lineOf(stripped, declarationStart),
        property,
        `per-frame transitions trigger layout; use transform/opacity instead, or register the reason in check-motion-css.mjs EXEMPTIONS`
      );
    }
  }
}

// ---------- Overlay geometry tokens ----------
//
// VARIANT_GEOMETRY in presence.ts is the single numeric source for translation and scale;
// easingTokens.ts projects it per role into --motion-travel-<role> / --motion-scale-<role>, and
// CSS keyframes only consume them by name. This chain has two failure modes that raise no error:
//
//   1. A misspelled role name. CSS custom properties have no notion of "undefined" — when var()
//      gets no value the whole declaration becomes invalid at computed-value time, so the
//      translation **and the scale** in transform disappear together. The page merely looks like
//      "no animation was written", the console is clean, and no test turns red.
//   2. The token is not registered in theme.css's @theme. @theme variables are pruned by
//      reference, and ones no CSS references are deleted, so the first frame before JS is ready
//      has no fallback value.
//
// The test is therefore bidirectional: a role referenced by CSS must really exist, and it must
// already be registered.

/** Extract the top-level key names of VARIANT_GEOMETRY in presence.ts. */
function geometryRoles() {
  const source = fs.readFileSync(path.join(SRC, 'lib/motion/presence.ts'), 'utf8');
  const at = source.indexOf('VARIANT_GEOMETRY');
  if (at < 0) return null;
  const open = source.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  const roles = new Set();
  for (const match of source.slice(open + 1, end).matchAll(/^ {2}([A-Za-z][A-Za-z0-9_]*)\s*:/gm)) {
    roles.add(match[1]);
  }
  return roles;
}

const GEOMETRY_ROLES = geometryRoles();
const THEME_CSS = path.join(SRC, 'styles/theme.css');

function checkGeometryTokens(file, css) {
  const refs = [...css.matchAll(/var\(\s*--motion-(travel|scale)-([a-z0-9-]+)\s*\)/g)];
  if (refs.length === 0) return;

  if (GEOMETRY_ROLES === null || GEOMETRY_ROLES.size === 0) {
    report(file, 1, '--motion-travel-*', 'cannot parse VARIANT_GEOMETRY from presence.ts; the geometry token check is disabled');
    return;
  }

  const themeCss = fs.readFileSync(THEME_CSS, 'utf8');
  for (const match of refs) {
    const [, kind, role] = match;
    const token = `--motion-${kind}-${role}`;
    if (!GEOMETRY_ROLES.has(role)) {
      report(
        file,
        lineOf(css, match.index),
        token,
        `role "${role}" is not in presence.ts VARIANT_GEOMETRY; var() getting no value invalidates the whole transform (translation and scale are both lost)`
      );
      continue;
    }
    if (!new RegExp(`^\\s*${token}\\s*:`, 'm').test(themeCss)) {
      report(file, lineOf(css, match.index), token, `${token} is not registered in styles/theme.css @theme, so the first frame before JS is ready has no fallback value`);
    }
  }

  // A role that is registered but consumed by no keyframe is pruned by Tailwind — either a typo or a leftover registration.
  const cssText = collect(SRC, ['.css']).map((other) => stripComments(fs.readFileSync(other, 'utf8')));
  for (const match of themeCss.matchAll(/^\s*--motion-(travel|scale)-([a-z0-9-]+)\s*:/gm)) {
    const [, kind, role] = match;
    const token = `--motion-${kind}-${role}`;
    const pattern = new RegExp(`var\\(\\s*${token}\\s*\\)`);
    if (!cssText.some((text) => pattern.test(text))) {
      report(THEME_CSS, lineOf(themeCss, match.index), token, `${token} is registered but no keyframe consumes it, so @theme will prune it`);
    }
  }
}

// ---------- TS / TSX ----------

/** In Tailwind arbitrary values, `_` stands for a space. */
function normalizeArbitrary(value) {
  return value.replace(/_/g, ' ').trim();
}

/**
 * Resolve top-level string / template-string constants within the same file.
 *
 * The value of an inline transition is often a module constant (for example
 * `transition: GEOMETRY_TRANSITION`). Looking only at literals misses them, and the
 * `TourSpotlight.tsx` exemption was never actually triggered before this check was tightened
 * precisely because "the value is not a literal".
 */
function resolveConstant(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?:const|let|var)\\s+${escaped}(?:\\s*:[^=]+)?\\s*=\\s*[\`'"]([^\`'"]*)[\`'"]`
  );
  const match = pattern.exec(source);
  return match ? match[1] : null;
}

/** Primitive type names in TS type positions — here `transitionProperty:` is an interface field, not an inline style. */
const TS_TYPE_KEYWORDS = new Set([
  'string',
  'number',
  'boolean',
  'any',
  'unknown',
  'never',
  'void',
  'object',
]);

function checkScript(file) {
  const source = stripComments(fs.readFileSync(file, 'utf8'));
  if (!/transition/i.test(source)) return;

  // Tailwind utility classes: transition-[width] / transition-[background,box-shadow]
  for (const match of source.matchAll(/(?<![\w-])transition-\[([^\]"'\s]+)\]/g)) {
    for (const raw of match[1].split(',')) {
      const property = normalizeArbitrary(raw);
      if (property === '') continue;
      if (COMPOSITOR_SAFE.has(property) || isExempt(file, property)) continue;
      report(file, lineOf(source, match.index), property, 'transition-[...] per-frame transitions trigger layout; use transform/opacity instead');
    }
  }

  // transition-all: pulls every present and future animatable property into the transition, so layout properties will mix in sooner or later
  for (const match of source.matchAll(/(?<![\w-])transition-all(?![\w-])/g)) {
    report(file, lineOf(source, match.index), 'transition-all', 'forbidden; list properties explicitly so layout properties are not transitioned in passing');
  }

  // Inline styles: transition / transitionProperty, all three forms must be recognized —
  //   - object literal: `transition: '…'` / `transitionProperty: '…'`
  //   - assignment:     `el.style.transition = '…'`
  //   - module constant: `transition: GEOMETRY_TRANSITION`
  // The former `(?:-property)?\s*:` did not match the camelCase `transitionProperty`, so
  // `style={{ transitionProperty: 'width 200ms' }}` could pass silently.
  //
  // The shape of the value decides whether it is an inline style: a member expression (`a.b.c`)
  // reads or writes runtime state, and a primitive type name is an interface field — neither is a
  // CSS value that can be statically evaluated.
  const inlinePattern =
    /(?<![\w-])transition(?:-?[Pp]roperty)?\s*[:=]\s*(?:[`'"]([^`'"]*)[`'"]|([A-Za-z_$][\w$.]*))/g;
  for (const match of source.matchAll(inlinePattern)) {
    const literal = match[1];
    let value = literal;
    if (value === undefined) {
      const raw = match[2];
      if (raw.includes('.') || TS_TYPE_KEYWORDS.has(raw)) continue;
      const resolved = resolveConstant(source, raw);
      if (resolved === null) {
        report(
          file,
          lineOf(source, match.index),
          raw,
          'the value of the inline transition cannot be statically confirmed; make it a literal or a module-level string constant, or layout properties can hide here'
        );
        continue;
      }
      value = resolved;
    }
    if (value === '' || value === 'none' || value === 'initial' || value === 'unset') continue;
    for (const part of splitTopLevel(value)) {
      if (part === 'none' || part === 'initial' || part === 'unset') continue;
      const property = propertyOf(part);
      if (property === null) continue;
      if (COMPOSITOR_SAFE.has(property) || isExempt(file, property)) continue;
      report(file, lineOf(source, match.index), property, 'inline transition per-frame transitions trigger layout; use transform/opacity, or register an exemption');
    }
  }
}

// ---------- Traversal ----------

for (const file of collect(SRC, ['.css'])) checkCss(file);
for (const file of collect(SRC, ['.ts', '.tsx'])) checkScript(file);

if (errors.length > 0) {
  console.error(`motion property gate failed (${errors.length} items):\n`);
  for (const line of errors) console.error(`  ${line}`);
  console.error('\nthe cost of per-frame transitioning layout properties appears in no existing test, so it has to be stopped here.');
  process.exit(1);
}

console.log('motion property gate passed: transitions and keyframes only involve paint-layer properties.');
