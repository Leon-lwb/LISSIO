#!/usr/bin/env node
// Frontend token and structure checks.
//
// Prevents raw visual colors, oversized frontend source files, and monolithic component styles. Usage: pnpm check:tokens.
//
// Rules (apply to src/**/*.{ts,tsx,css}, skipping src/types/generated):
//   1. opacity tiers — a class string may only use:
//        opacity-0 / opacity-100            show/hide animation (whitelisted in the textTone.ts header comment)
//        opacity-{faint,subtle,disabled,muted,secondary}   tier utility classes (--opacity-* bridge)
//      Any other opacity-NN / opacity-[...] is an error.
//   2. palette shades — {text,bg,border,ring,fill,stroke,divide}-<hue>-<NN> is an error:
//      the shade value comes from the Tailwind default palette and does not follow the theme. A
//      bare hue (text-green / bg-blue) resolves through an @theme token (--color-green …) and is
//      allowed.
//   3. text-white is an error — white text always uses text-text-inverse / text-text-bright
//      (theme-aware); text-black / bg-white / bg-black are fixed neutrals (through
//      --color-black/white) and are allowed.
//   4. opacity: inside a CSS component rule must reference a var(--alpha-*) tier; @keyframes
//      animation interpolation (0/1/0.85 and the like) and show/hide semantics are not the token
//      layer and pass.
//   5. frosted surfaces — TS/TSX must not write backdrop-* utility classes; CSS may combine
//      blur/saturate only through --frost-* tokens.
//   6. synchronization — four single sources must agree:
//        theme.css --alpha-*        ↔ textTone.ts TEXT_TONE_ALPHA (names and values)
//        theme.css --alpha-*        ↔ theme.css --opacity-* bridge (each tier usable as a utility)
//        textTone.ts class names    ↔ matching --color-text-* token / state-* utility in theme.css
//        theme.ts semantic aliases  ↔ matching token exists in theme.css (otherwise runtime injection dangles)
//
// Explicitly out of this layer (surface/border/shadow layer, handled separately): rgba in
// box-shadow, canvas ctx.fillStyle, terminal ANSI colors. See the layering notes in
// docs/architecture/ui-color-tokens.md.

import fs from 'node:fs';
import path from 'node:path';

import { frontendRoot, repositoryRoot } from './repo-root.mjs';

/** The frontend repository: `<repo>/client` inside the umbrella, `<repo>` in a copy. */
const root = frontendRoot(repositoryRoot());
const errors = [];

/// Tailwind default palette hues (a bare hue goes through an @theme token and is allowed; a shade is forbidden)
const HUES =
  'red|amber|yellow|green|emerald|lime|blue|sky|cyan|orange|zinc|slate|gray|stone|indigo|violet|purple|pink|rose|teal|fuchsia';
const PALETTE_SHADE = new RegExp(`\\b(?:text|bg|border|ring|fill|stroke|divide)-(?:${HUES})-\\d`);
const RAW_OPACITY = /(?<![-\w])opacity-(?!0\b|100\b)\d/;
const ARBITRARY_OPACITY = /(?<![-\w])opacity-\[/;
const TEXT_WHITE = /(?<![\w-])text-white(?![\w-])/;
const RAW_FROST = /\bbackdrop-(?:blur(?:-|\[)|filter\s*:)/;
const LEGACY_FROST_TOKEN = /--(?:widget-acrylic|blur-acrylic|saturate-acrylic|shadow-modal)-?/;
// Refraction tier (data-glass-tier='liquid'): one shared selector, and the override rule that
// "pointer-events must be explicitly reclaimed". Both are reused by rules #5/#6.
const LIQUID_SELECTOR = /\[data-glass-tier=['"]liquid['"]\]/;
const LIQUID_POINTER_EVENTS =
  /\[data-glass-tier=['"]liquid['"]\][^{}]*\{[^{}]*pointer-events:\s*auto\s*!important/;
const RAW_CSS_COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;
const FRONTEND_LIMIT = 500;

// Animation token check
const TAILWIND_ANIMATION = /\b(animate-spin|animate-pulse|animate-bounce|animate-ping)\b/;
// Exact paths; do not use an endsWith suffix match: `reduced-motion.css` ends with
// `motion.css`, so the "no hard-coded durations" rule would silently let it through — and it
// happens to be the one file that **must** hard-code durations (compressing animation to 1ms is
// its job).
const DURATION_WHITELIST = [
  'src/styles/theme.css',
  'src/styles/component-tokens.css',
  'src/styles/components/motion.css',
  'src/styles/components/reduced-motion.css',
];

/** Recursively collect files under src with the given extensions. When extensions is omitted, collect all of ts/tsx/css. */
function collect(dir, extensions, out = []) {
  const exts = extensions ?? ['.ts', '.tsx', '.css'];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'generated') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(p, extensions, out);
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(p);
  }
  return out;
}

/** Strip whole-line comments (// / /// / //! / * / /*) — counterexamples in doc comments must not trigger rules */
function stripCommentLines(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : line;
}

/** Strip CSS comment blocks — replace them with equal-length whitespace rather than deleting them, so offsets and line numbers match the original */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

/**
 * Strip @keyframes blocks (animation interpolation is not the token layer) while preserving
 * line numbers.
 *
 * Only the body of @keyframes is removed: `opacity: 0.5` inside a keyframe is interpolation and
 * must not be held to the tier-token requirement. A previous implementation entered a skip state
 * on any `{`, which ate the declaration body of **every** rule — so the two rules that follow
 * (bare `opacity:` and `backdrop-filter:` must go through `--frost-*`) never matched a single
 * rule anywhere in the repository. This matches `@keyframes <name> {` explicitly and then
 * balances braces to find the end of the block.
 */
function stripKeyframes(css) {
  const pattern = /@keyframes\s+[\w-]+\s*\{/g;
  let out = '';
  let last = 0;
  let match = pattern.exec(css);
  while (match !== null) {
    out += css.slice(last, match.index);
    let depth = 1;
    let cursor = pattern.lastIndex;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1;
      else if (css[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    // Replace with equal-length whitespace (keeping newlines) so offsets and line numbers match the original.
    const block = css.slice(match.index, cursor);
    out += block.replace(/[^\n]/g, ' ');
    last = cursor;
    pattern.lastIndex = cursor;
    match = pattern.exec(css);
  }
  out += css.slice(last);
  return out;
}

for (const file of collect(path.join(root, 'src'))) {
  const rel = path.relative(root, file);
  const isCss = file.endsWith('.css');
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');

  // Animation token check (outside the loop, over the whole file content)
  const normalizedRel = rel.split(path.sep).join('/');
  const isDurationWhitelist = DURATION_WHITELIST.includes(normalizedRel);
  if (!isDurationWhitelist && isCss) {
    const durationRe = /(?<![-\w])(\d+(?:\.\d+)?)(ms|s)\b/g;
    let dm;
    while ((dm = durationRe.exec(raw)) !== null) {
      if (dm[1] === '0') continue;
      const line = raw.slice(0, dm.index).split('\n').length;
      errors.push(`${rel}:${line}  hard-coded duration ${dm[0]} — use a var(--motion-duration-*) or var(--duration-*) token`);
    }
  }
  if (TAILWIND_ANIMATION.test(raw)) {
    const line = raw.split('\n').findIndex((l) => TAILWIND_ANIMATION.test(l)) + 1;
    errors.push(`${rel}:${line}  built-in Tailwind animation — use motion-spin / motion-pulse instead`);
  }
  if (isCss && !normalizedRel.endsWith('styles/theme.css')) {
    // Remove var(--ease-*) references and linear-gradient before checking for bare easing functions
    const cssWithoutEaseVars = raw
      .replace(/var\(--ease-[a-z-]+\)/g, '')
      .replace(/linear-gradient\(/g, '');
    const easeRe = /cubic-bezier\(|(?<![-\w])ease-in\b|(?<![-\w])ease-out\b|(?<![-\w])ease-in-out\b|(?<![-\w])linear\b/g;
    let em;
    while ((em = easeRe.exec(cssWithoutEaseVars)) !== null) {
      const line = cssWithoutEaseVars.slice(0, em.index).split('\n').length;
      errors.push(`${rel}:${line}  bare easing function — use a var(--ease-*) token`);
    }
  }

  lines.forEach((line, i) => {
    const code = stripCommentLines(line);
    if (!code) return;
    const at = `${rel}:${i + 1}`;

    if (!isCss) {
      if (RAW_OPACITY.test(code)) {
        errors.push(`${at}  bare opacity-NN — use the tier classes opacity-faint/subtle/disabled/muted/secondary or disabled:opacity-disabled (show/hide animation may only use 0/100)`);
      }
      if (ARBITRARY_OPACITY.test(code)) {
        errors.push(`${at}  arbitrary opacity-[…] — opacity may only go through --alpha-* tiers`);
      }
      if (PALETTE_SHADE.test(code)) {
        errors.push(`${at}  palette shade (hue-NN) does not follow the theme — use text-text-* semantic roles for text, state-* for badges, and token+opacity modifiers for backgrounds/borders (bg-warning/10)`);
      }
      if (TEXT_WHITE.test(code)) {
        errors.push(`${at}  text-white does not follow the theme — use text-text-inverse / text-text-bright`);
      }
      if (RAW_FROST.test(code)) {
        errors.push(`${at}  bare backdrop-* — frosted surfaces uniformly use float-card / frost-surface and --frost-* tokens`);
      }
    }
  });

  const isTest = normalizedRel.includes('__tests__') || /\.(test|spec)\.(ts|tsx)$/.test(normalizedRel);
  if (!isTest && lines.length > FRONTEND_LIMIT) {
    errors.push(`${rel}:${lines.length}  frontend production file exceeds ${FRONTEND_LIMIT} lines — split it by responsibility and keep the public API stable`);
  }
  if (
    isCss &&
    !normalizedRel.endsWith('styles/theme.css') &&
    !normalizedRel.endsWith('styles/component-tokens.css') &&
    RAW_CSS_COLOR.test(raw.replace(/\/\*[\s\S]*?\*\//g, ''))
  ) {
    errors.push(`${rel}  bare CSS color — colors may only be defined in theme.css / component-tokens.css; component rules use var(--*)`);
  }

  if (isCss && !normalizedRel.endsWith('styles/theme.css')) {
    const css = stripKeyframes(raw);
    const re = /(^|[;{\s])opacity:\s*(?!var\()([0-9]*\.?[0-9]+)/g;
    let m;
    while ((m = re.exec(css)) !== null) {
      const value = m[2];
      if (value === '0' || value === '1') continue; // show/hide semantics pass
      const line = css.slice(0, m.index).split('\n').length;
      errors.push(`${rel}:${line}  bare opacity: ${value} — use a var(--alpha-*) tier (except @keyframes animation interpolation)`);
    }
    for (const m of css.matchAll(/(?:^|[;{\s])-?backdrop-filter:\s*([^;]+);/g)) {
      const value = m[1].trim();
      if (value === 'none') continue;
      if (!value.includes('blur(var(--frost-blur') || !value.includes('saturate(var(--frost-saturate')) {
        const line = css.slice(0, m.index).split('\n').length;
        errors.push(`${rel}:${line}  backdrop-filter does not uniformly go through --frost-blur/--frost-saturate tokens`);
      }
    }
  }

}

// ---------- Synchronization: four single sources ----------

const themeCss = fs.readFileSync(path.join(root, 'src/styles/theme.css'), 'utf8');
const textTone = fs.readFileSync(path.join(root, 'src/lib/ui/textTone.ts'), 'utf8');
const themeTs = fs.readFileSync(path.join(root, 'src/settings/theme.ts'), 'utf8');

for (const token of [
  '--color-float-surface',
  '--color-dialog-chrome',
  '--color-dialog-chrome-muted',
  '--shadow-float',
  '--shadow-popover',
  '--frost-blur',
  '--frost-saturate',
  '--frost-alpha-widget',
  '--frost-alpha-floating',
  '--frost-alpha-chrome',
  '--frost-border',
  '--frost-highlight',
  '--frost-shadow',
]) {
  if (!themeCss.includes(`${token}:`)) {
    errors.push(`sync: theme.css is missing frosted token ${token}`);
  }
}
if (LEGACY_FROST_TOKEN.test(themeCss)) {
  errors.push('sync: theme.css still has legacy frosted tokens — use --frost-* uniformly');
}

/// theme.css --alpha-* tiers (name -> percentage value)
const alphaTiers = {};
for (const m of themeCss.matchAll(/^\s*--alpha-([a-z]+):\s*([0-9.]+)%;/gm)) {
  alphaTiers[m[1]] = Number(m[2]);
}

/// textTone.ts TEXT_TONE_ALPHA whitelist (name -> decimal)
const toneBlock = textTone.match(/TEXT_TONE_ALPHA[^=]*=\s*\{([\s\S]*?)\};/);
const toneAlphas = {};
if (toneBlock) {
  for (const m of toneBlock[1].matchAll(/([a-z]+):\s*([0-9.]+),/g)) {
    toneAlphas[m[1]] = Number(m[2]) * 100;
  }
}

const tierNames = Object.keys(alphaTiers);
if (tierNames.length === 0) errors.push('theme.css: no --alpha-* tiers parsed (did the format change?)');
for (const name of tierNames) {
  if (!(name in toneAlphas)) {
    errors.push(`sync: theme.css --alpha-${name} is missing from textTone.ts TEXT_TONE_ALPHA`);
  } else if (toneAlphas[name] !== alphaTiers[name]) {
    errors.push(`sync: --alpha-${name} value mismatch — theme.css ${alphaTiers[name]}% vs TEXT_TONE_ALPHA ${toneAlphas[name]}%`);
  }
}
for (const name of Object.keys(toneAlphas)) {
  if (!(name in alphaTiers)) {
    errors.push(`sync: TEXT_TONE_ALPHA.${name} has no --alpha-${name} definition in theme.css`);
  }
}

/// Every tier must have an --opacity-* bridge (otherwise the tier cannot be used as a utility class)
const bridged = new Set([...themeCss.matchAll(/--opacity-([a-z]+):\s*var\(--alpha-/g)].map((m) => m[1]));
for (const name of tierNames) {
  if (!bridged.has(name)) errors.push(`sync: --alpha-${name} is missing the --opacity-${name} bridge (theme.css @theme)`);
}

/// textTone.ts class name -> theme.css token / utility
/// The class `text-text-X` = utility prefix `text-` + color name `text-X` → the token is `--color-text-X`
for (const m of textTone.matchAll(/'(text-text-[a-z-]+)'/g)) {
  const varName = `--color-${m[1].replace(/^text-/, '')}`;
  if (!themeCss.includes(`${varName}:`)) {
    errors.push(`sync: textTone.ts class ${m[1]} is missing the ${varName} token in theme.css`);
  }
}
for (const m of textTone.matchAll(/'(state-[a-z]+)'/g)) {
  if (!themeCss.includes(`@utility ${m[1]}`)) {
    errors.push(`sync: textTone.ts class ${m[1]} is missing the @utility ${m[1]} registration in theme.css (variant forms would silently fail)`);
  }
}

/// theme.ts semantic alias -> the theme.css token exists
const aliasBlock = themeTs.match(/SEMANTIC_TOKEN_ALIASES[^=]*=\s*\{([\s\S]*?)\n\};/);
if (!aliasBlock) {
  errors.push('sync: could not parse SEMANTIC_TOKEN_ALIASES from theme.ts');
} else {
  for (const m of aliasBlock[1].matchAll(/'(--[a-z-]+)':/g)) {
    if (!themeCss.includes(`${m[1]}:`)) {
      errors.push(`sync: theme.ts alias ${m[1]} has no definition in theme.css (runtime injection would dangle)`);
    }
  }
}

// ---------- Frosted overlays ----------
// The overlay's base-color rule is a solid color shared by all roles, while frosting is declared
// separately by data-floating-glass. Once a class appears only in the solid rule and is left out
// of the glass rule, it still renders as a solid color when both switches are on — no error, no
// warning, it just looks like "there is no acrylic". This class of defect can only be caught by a
// structural check.
const surfaceCss = fs
  .readFileSync(path.join(root, 'src/styles/components/dialog-surface.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

{
  const rolesBeforeBrace = (index) => {
    const open = surfaceCss.indexOf('{', index);
    const selector = surfaceCss.slice(0, open);
    const start = Math.max(selector.lastIndexOf('}'), selector.lastIndexOf(';'));
    return selector
      .slice(start + 1)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.replace(/^\[data-floating-glass='true'\]\s*/, '').replace(/^\./, ''));
  };

  const baseAt = surfaceCss.indexOf('.dialog-surface');
  const glassAt = surfaceCss.indexOf("[data-floating-glass='true']");
  if (baseAt < 0 || glassAt < 0) {
    errors.push('frost: could not parse the overlay solid rule or glass rule from dialog-surface.css');
  } else {
    const base = rolesBeforeBrace(baseAt);
    const glass = rolesBeforeBrace(glassAt);
    for (const role of base) {
      if (!glass.includes(role)) {
        errors.push(
          `frost: .${role} is in the overlay solid rule but has no matching glass rule — it still renders solid when the switch is on`
        );
      }
    }
  }
}

// ---------- Frosted overlays: content-area ownership and base-color token ----------
// The transparency of the overlay's content area must be decided by data-floating-glass. If it
// keeps depending on data-acrylic, turning off window acrylic produces the mismatch of "glass
// frame, opaque body".
// Also, the content area must not carry its own backdrop-filter: the overlay body already
// filters, and a child layer filtering again double-blurs.
if (surfaceCss.includes('.frost-content')) {
  const contentBlock = surfaceCss.slice(surfaceCss.indexOf('.frost-content'));
  const contentRule = contentBlock.slice(0, contentBlock.indexOf('}') + 1);
  if (/backdrop-filter/.test(contentRule)) {
    errors.push('frost: .frost-content must not carry its own backdrop-filter — the overlay body already filters, and stacking double-blurs');
  }
  if (/\[data-acrylic='true'\][^{]*\.frost-content/.test(surfaceCss)) {
    errors.push(
      "frost: .frost-content must not hang under [data-acrylic='true'] — overlay transparency is decided by data-floating-glass"
    );
  }
  // The base color must go through its own token, or window acrylic's translucency is applied on top a second time.
  if (!/background-color:[^;]*var\(--color-float-content\)/.test(surfaceCss)) {
    errors.push('frost: .frost-content base color must use var(--color-float-content)');
  }
}

// --color-float-content must be injected by applyAppearance from the theme's base colors
{
  const applyTheme = fs.readFileSync(path.join(root, 'src/settings/applyTheme.ts'), 'utf8');
  if (!/setProperty\(\s*'--color-float-content'\s*,\s*activeTheme\.tokens\.bgEditor\s*\)/.test(applyTheme)) {
    errors.push('sync: applyAppearance does not inject --color-float-content from the theme base colors');
  }
}

// ---------- Structural budget for frosting ----------
//
// Replaces the deleted `gaussian-budget` scenario. That scenario used the "difference in frame
// interval p95 with acrylic on/off" as its budget, and the measured difference was 2.27e-13 ms —
// not evidence that "blur is cheap" but measurement saturation: a headless BeginFrame is locked
// to 60Hz and both sides are quantized onto the same 16.7ms grid. More fundamentally,
// backdrop-filter is done in the compositor while the browser probe measures the main-thread
// prototype. See docs/performance/frontend-render-budget.md.
//
// So instead we catch waste that is **deterministically derivable from the source**. None of
// these need a browser, and they do not drift with runner load; they guard against "paying for
// nothing", not "low frame rate".

/**
 * Registry of frosted surfaces. `alpha` is the base-color opacity percentage and `blur` is the
 * blur radius in px.
 *
 * This is not an aesthetics list, it is a price list: the cost of blur is proportional to radius
 * times area, and it is paid **only on the frame where the backdrop is invalidated**. So radius
 * and opacity must be registered together — the more opaque the base color, the less the blur is
 * visible, and the more that money is wasted.
 */
const FROST_SURFACES = [
  // class name, description
  ['widget-card-acrylic', 'node cards and canvas-style widgets'],
  ['dock-card-acrylic', 'dock card shell'],
  ['frost-surface', 'inner surfaces of panels such as the AI input area'],
  ['frost-acrylic', 'toasts and the status bar'],
];

// The base-color opacity above which the blur is essentially invisible. At alpha 90% an 18px blur
// is nearly indistinguishable from a solid color yet is paid for in full — such surfaces should
// either drop to a level where the blur is visible or drop the blur.
const OPAQUE_ENOUGH = 85;

{
  const theme = themeCss;
  const allCss = collect(path.join(root, 'src'), ['.css'])
    .filter((f) => !f.endsWith('generated'))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');
  const allCode = collect(path.join(root, 'src'), ['.ts', '.tsx'])
    .filter((f) => !f.includes(`${path.sep}generated${path.sep}`))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');

  // 1) Every frosted surface must have an alpha tier, or base-color opacity and blur radius go their separate ways.
  for (const [cls] of FROST_SURFACES) {
    if (!new RegExp(`\\.${cls}\\b`).test(allCss + allCode)) continue;
    if (!/--frost-alpha-[a-z-]+/.test(theme)) {
      errors.push(`frost: .${cls} exists but theme.css has no --frost-alpha-* tier`);
    }
  }

  // 2) --frost-alpha-surface is the base-color tier of .frost-surface and must not be so high
  //    that the blur is paid for nothing. The more opaque the base color, the less the blur is
  //    visible, so that money is paid in full and buys nothing.
  const surfaceAlpha = /--frost-alpha-surface:\s*([\d.]+)%/.exec(theme);
  if (!surfaceAlpha) {
    errors.push('frost: theme.css is missing --frost-alpha-surface — the .frost-surface base-color tier loses its single source');
  } else if (Number(surfaceAlpha[1]) >= OPAQUE_ENOUGH) {
    errors.push(
      `frost: --frost-alpha-surface=${surfaceAlpha[1]}% ≥ ${OPAQUE_ENOUGH}% — with a base color this opaque ` +
        `backdrop-filter is essentially invisible yet is paid for in full; lower it to a level where the blur is visible, or remove the blur there`
    );
  }

  // 3) Every --frost-alpha-* tier must be used in at least one place. Deleting a tier but leaving
  //    its definition makes the next person believe it is still in effect.
  for (const m of theme.matchAll(/--frost-alpha-([a-z-]+):/g)) {
    const token = `--frost-alpha-${m[1]}`;
    const used = allCss.includes(`var(${token})`) || allCode.includes(token);
    if (!used) errors.push(`frost: theme.css defines ${token} but nothing references it — a dead token masquerades as a tier still in effect`);
  }

  // 4) Nested backdrop-filter is not a performance problem, it is **silent failure**: an element
  //    with a blur becomes its own Backdrop Root, so a blur inside it can only sample that layer,
  //    and "the frosting is gone" with no error at all. Once this slips through, every later
  //    discussion of frosting cost loses its premise.
  //
  //    The test can only be based on the **same selector** — selected by two blurred classes at
  //    once. That covers both `A.b { backdrop-filter }` and `.a.b { backdrop-filter }` without
  //    guessing the DOM structure.
  const styleFiles = collect(path.join(root, 'src/styles'), ['.css']);
  for (const file of styleFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const blurred = new Set();
    for (const m of source.matchAll(/([^{}]+)\{([^{}]*backdrop-filter[^{}]*)\}/g)) {
      const selector = m[1];
      // A descendant/child combinator (containing a space or >) is "nested", not "the same element", and does not count here.
      if (/[ >]/.test(selector.trim())) continue;
      for (const cls of selector.matchAll(/\.([a-z0-9-]+)/g)) blurred.add(cls[1]);
    }
    // Check rule by rule: if its selector matches two blurred classes at once, two layers are stacked on the same element.
    for (const m of source.matchAll(/([^{}]+)\{([^{}]*backdrop-filter[^{}]*)\}/g)) {
      const classes = [...m[1].matchAll(/\.([a-z0-9-]+)/g)].map((c) => c[1]);
      if (classes.length < 2) continue;
      const alsoBlurred = classes.filter((c) => blurred.has(c));
      if (alsoBlurred.length < 2) continue;
      errors.push(
        `frost: \`${m[1].trim().slice(0, 70)}\` in ${path.relative(root, file)} stacks ` +
          `${alsoBlurred.length} backdrop-filter layers (${alsoBlurred.map((c) => '.' + c).join(' ')}) — ` +
          `WebKit renders only the outermost, so the frosting silently disappears`
      );
    }

    // 5) The refraction tier (data-glass-tier='liquid') must not **add** backdrop-filter.
    //
    //    This shares a source with rule 4 but points the other way: that one guards against
    //    "blur stacked twice", this one against "the refractive surface still keeps a blur".
    //    liquidGL's refraction canvas can only sample the backdrop inside the element's Backdrop
    //    Root; as long as the element still has a backdrop-filter it is its own Backdrop Root, so
    //    the refraction bends onto an already-blurred layer — the bend visually vanishes with no
    //    error or warning at all.
    //
    //    The test is "in a rule with a liquid selector, backdrop-filter may only be none", not
    //    "every liquid rule must write backdrop-filter: none": the latter is too broad and would
    //    flag rules unrelated to blur, such as pointer-events. And which rule the none goes in
    //    matters — it must be in the same rule as the role class (specificity (0,2,0)) to beat
    //    `[data-floating-glass='true'] .dialog-surface`; that constraint belongs to the "solid
    //    rule / glass rule role alignment" check earlier in this file.
    //
    //    Comments must be stripped before scanning: the selector part of the rule regex is
    //    `[^{}]+`, which swallows the comment block following the previous rule, so "the comment
    //    mentions liquid" is taken as "the rule declares liquid". Comment content is replaced with
    //    equal-length whitespace rather than deleted — offsets and line numbers must match the
    //    original.
    const code = stripCssComments(source);
    for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!LIQUID_SELECTOR.test(m[1])) continue;
      for (const bf of m[2].matchAll(/(?:^|;)\s*-?(?:webkit-)?backdrop-filter:\s*([^;]+)/g)) {
        if (bf[1].trim() !== 'none') {
          const line = code.slice(0, m.index).split('\n').length;
          errors.push(
            `frost: \`${m[1].trim().slice(0, 70)}\` at ${path.relative(root, file)}:${line} adds blur ` +
              `to the refraction tier (${bf[1].trim().slice(0, 40)}) — the element is still its own Backdrop Root and the refraction silently fails`
          );
        }
      }
    }
  }

  // 6) The refraction tier must explicitly reclaim pointer-events.
  //
  //    liquidGL's _activate() sets the target to pointer-events: none, assuming interaction is
  //    handled by its "content layer"; that layer is a pixel mirror of the element drawn into a
  //    canvas and cannot receive pointer events. So every surface under the refraction tier is
  //    unclickable — the settings UI simply loses interaction.
  //
  //    Only a CSS `!important` can cover this: _activate() may run as late as the GPU backend
  //    becoming ready, meaning it sets the inline style to none **after** assembly completes, so
  //    "clear it once right after mounting" is nondeterministic (the same code was measured
  //    clickable on one of two runs). Author styles' !important beats a normal inline style
  //    regardless of the library's timing.
  //
  //    This is a global constraint: the rule can only be written once among the surface styles
  //    that declare liquid, so judge the union of all CSS under src/styles once. Per-file judgment
  //    would require every CSS file to carry the rule, which is a scoping error (every file except
  //    dialog-surface.css would be a false positive).
  const allStylesCode = styleFiles
    .map((file) => stripCssComments(fs.readFileSync(file, 'utf8')))
    .join('\n');
  if (!LIQUID_POINTER_EVENTS.test(allStylesCode)) {
    errors.push(
      "frost: the refraction tier lacks the `pointer-events: auto !important` override — liquidGL sets the target to " +
        "pointer-events: none (its content layer is a pixel mirror and receives no events), leaving the surface completely non-interactive",
    );
  }
}

// ---------- Output ----------

if (errors.length > 0) {
  console.error(`check:tokens failed — ${errors.length} violations:\n`);
  for (const e of errors) console.error(`  ${e}`);
  console.error('\nSpec: docs/architecture/ui-color-tokens.md | single source for tiers: src/styles/theme.css');
  process.exit(1);
}
console.log(`check:tokens passed — ${tierNames.length} opacity tiers (${tierNames.join('/')}), semantic tokens, and frontend structure rules are in sync.`);
