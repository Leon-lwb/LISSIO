#!/usr/bin/env node
// Frontend layering gate — turns the dependency direction of "implementation / interaction /
// effects / view layers" from prose into a CI check.
// Usage: pnpm check:layers
//
// Why this gate exists:
//
//   1. Frontend layering has only ever been held up by comments and review.
//      `server/docs/architecture/architecture-review-2026-09.md` names "the frontend still has large
//      files" as the only frontend architecture debt and contains no layering model at all;
//      `pnpm check:architecture` / `check:deps` only cover Rust, so the frontend structure has
//      no machine constraint.
//   2. A reverse dependency turns no existing test red and raises no error — it just adds one
//      more surprise to the next change. For example, `widgets/` importing a status-bar
//      component from `displays/` looks entirely reasonable in that one line, and the cost only
//      shows up when someone wants to reuse the widget layer on its own.
//   3. Once the dependency direction may freely reverse, "registry / binding / primitive"
//      becomes polluted by implementation details from the view, and a unified model is out of
//      the question. So the direction must be enforceable, not a recommendation.
//
// Scope: module specifiers (static import / export from / dynamic import() / require) of every
// .ts/.tsx under src. Relative paths are resolved and judged by directory prefix, with no
// type-layer analysis — the gate must run on any commit, not only inside an IDE.
//
// Exemptions: see the EXEMPTIONS table below. Exemptions are public and state their reason one
// by one; adding one admits a deliberate exception; anything unregistered is an error.
// **The fix for a violation is to change the code, not to add an exemption.**
//
// Repository-root convention (`scripts/repo-root.mjs`): the gate reads the frontend repository —
// `client/` inside the umbrella, the repository itself in a copy — and `--root=<path>` selects
// another checkout. Every reported and matched path stays `src/…`, relative to that frontend.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { frontendRoot, repositoryRoot } from './repo-root.mjs';

/** The frontend repository: `<repo>/client` inside the umbrella, `<repo>` in a copy. */
const root = frontendRoot(repositoryRoot());
const SRC = path.join(root, 'src');
/** The only generated directory: TS contract output, not application source. */
const GENERATED_TYPES = path.join(SRC, 'types', 'generated');
const errors = [];

/**
 * Layering rules. `files` selects the checked files and `forbid` selects the target
 * directories that must not be depended on.
 *
 * There is only one direction: view → effects → interaction → implementation. Each rule
 * corresponds to a line in `client/docs/architecture/ui-layers.md`, with the same rule number.
 */
const RULES = [
  {
    id: 'L1',
    files: /^src\/components\/(?:ui|brand)\//,
    forbid: /^src\/components\/(?:common|nodes|layout|onboarding|panels|acquisition|displays|widgets|ai)\//,
    why: 'Base components (ui / brand) must not depend on any domain directory — every layer reuses them, and a reverse dependency lets the base components warp with the business',
  },
  {
    id: 'L2',
    files: /^src\/components\/(?:ui|brand)\//,
    forbid: /^src\/store\//,
    why: 'Base components stay pure through props and do not read the store directly — reading it ties "base" to the shape of global state and makes them impossible to render alone in tests',
  },
  {
    id: 'L3',
    files: /^src\/components\/widgets\//,
    forbid: /^src\/components\/(?:panels|displays|layout|acquisition|nodes|ai)\//,
    why: 'Widgets are the leaf content layer — only a panel registry may reference them, and they must not reference the panel / display layers, or a widget cannot be reused outside the full application shell',
  },
  {
    id: 'L4',
    files: /^src\/store\//,
    forbid: /^src\/components\//,
    why: 'The store is the implementation layer — once it depends on the view, the "widget → window panel → store" chain drags the whole display layer into the state module and creates a cycle outright',
  },
  {
    id: 'L5',
    files: /^src\/lib\/(?:motion|glass)\//,
    forbid: /^src\/store\//,
    why: 'The effects layer depends only on the implementation layer\'s data shapes and does not subscribe to the store — it must be callable with arguments from any layer, and subscribing to state would make it unreusable outside the application environment',
  },
  {
    id: 'L6',
    files: /^src\/lib\/(?:interaction|hooks)\//,
    forbid: /^src\/components\//,
    why: 'The interaction layer is a pure input → intent mapping and does not know the component tree — once it references the view, gesture primitives cannot exist apart from a concrete component',
  },
  {
    id: 'L7',
    files: /^src\/.*\.tsx?$/,
    forbid: null,
    why: 'On the JS side only lib/motion may write will-change / transitionProperty — compositing-layer promotion must go through promote()\'s reference count, and writing it by hand occupies the layer forever with nobody to release it',
  },
  {
    id: 'L8',
    files: /^src\/lib\/(?:rpc|platform|tauri|data|buffers|models|utils|panels)\//,
    forbid: /^src\/components\//,
    why: 'The implementation layer must not depend on the view — pulling view details into it would give pure modules such as requests / buffers / catalogs a rendering dependency',
  },
  {
    id: 'L9',
    files: /^src\/styles\/components\/dialog\.css$/,
    forbid: null,
    why: 'Overlay stacking may come only from the bridge class passed by the caller — a z-index in the base rule silently overrides it',
  },
  {
    id: 'L10',
    files: /^src\/lib\/(?:motion|glass)\//,
    forbid: /^src\/components\//,
    why: 'The effects layer must not know the view — it must be callable with arguments from any layer (tests, doc generation, non-application environments), and referencing a component turns "can this animation run alone?" into a question that requires reading the whole component tree',
  },
  {
    id: 'L11',
    files: /^src\/lib\/(?:interaction|hooks)\//,
    forbid: /^src\/lib\/(?:motion|glass)\//,
    why: 'The interaction layer only produces intent and does not know animation — the gesture says "how fast the release was", and the effects layer decides "how far and how long it therefore slides". Letting gestures drive the spring instead would move purely animation concerns (reduced-motion checks, token translation) into input handling, and tests that assert gesture behavior would have to set up an animation environment too',
  },
];

/**
 * Deliberate exceptions. Each must answer both: what it is, and why the direction reversal is
 * bounded here.
 *
 * This table is the complete list of "allowed reverse dependencies" — it should be short.
 * If it grows, the dependencies should change, not the exemptions.
 *
 * `movable: true` means the target is **misplaced** rather than genuinely needing a reverse
 * dependency: the target directory is pure data / pure functions and merely sits on the view
 * side. Moving it removes the need with no new abstraction.
 */
const EXEMPTIONS = [
  {
    file: 'src/components/ui/ContextMenu.tsx',
    rule: 'L2',
    reason: 'Global overlay singleton: it renders the contents of contextMenuStore itself and has no props to pass (isomorphic to DockDragGhost subscribing to dockDrag). It is the boundary case of "a view bound directly to a UI singleton", not a general-purpose base component.',
  },
  {
    file: 'src/lib/utils/connectionRules.ts',
    rule: 'L8',
    reason: 'Node connection rules must share a source with the port declarations in nodes/registry; otherwise the two would drift into different sets of legal connections.',
  },
];

/**
 * Compositing-layer / transition control properties forbidden to write by hand on the JS side (L7).
 *
 * All three documented forms must be covered, or the gate only stops the most honest one:
 *   - `el.style.willChange = 'transform'`  (assignment)
 *   - `{ willChange: 'transform' }`        (object literal)
 *   - `el.style.setProperty('will-change', …)`  (string argument)
 *   - `el.style['will-change'] = …`        (bracket access)
 * A property name written as a bare string literal IS the property, whatever follows the
 * literal: matching only `name:` / `name =` missed the `setProperty('will-change', …)`
 * and `style['will-change']` spellings while the comment above claimed they were covered.
 * The camelCase spelling `transitionProperty` matters especially — the inline regex in
 * `check:motion` only recognizes `transition` / `transition-property` followed by a colon,
 * so it once missed this spelling entirely.
 */
const FORBIDDEN_MOTION_WRITES = [
  {
    name: 'will-change / willChange',
    pattern: /(?:['"]will-?[Cc]hange['"]|(?<![\w-])will-?[Cc]hange\s*[:=])/g,
  },
  {
    name: 'transition-property / transitionProperty',
    pattern: /(?:['"]transition-?[Pp]roperty['"]|(?<![\w-])transition-?[Pp]roperty\s*[:=])/g,
  },
];

/** Every forbidden hand-written compositing-layer property in `source`. */
export function findMotionWrites(source) {
  const found = [];
  for (const { pattern, name } of FORBIDDEN_MOTION_WRITES) {
    for (const match of source.matchAll(pattern)) found.push({ name, index: match.index });
  }
  return found;
}

/** Module specifiers: static import / export from / dynamic import() / require(). */
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

/** Recursively collect files under src with the given extensions (skipping generated output). */
function collect(dir, extensions, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Only the generated TypeScript contract output is excluded. Skipping any
      // directory *named* `generated` at any depth made a real source directory
      // with that name invisible to all rules; anchor the skip to the exact path.
      if (p === GENERATED_TYPES) continue;
      collect(p, extensions, out);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(p);
  }
  return out;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

/** Strip block comments and whole-line comments while preserving line counts. */
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

/**
 * Resolve a relative specifier into an src-relative path (without extension).
 *
 * Only relative paths are handled: ownership of bare package names (@tauri-apps/*, react, …)
 * is `check:web-contract`'s job and is not judged again here.
 */
function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  let rel = path.relative(root, resolved).split(path.sep).join('/');
  // Directory imports like `../lib/motion` are covered by index.ts; strip the extension and compare prefixes uniformly.
  rel = rel.replace(/\.(?:tsx?|css|json)$/, '');
  return rel;
}

function isExempt(file, ruleId) {
  return EXEMPTIONS.some((entry) => entry.file === file && entry.rule === ruleId);
}

function report(file, line, message) {
  errors.push(`${file}:${line}  ${message}`);
}

function checkImports(file, source) {
  const rel = relative(file);
  const seen = new Set();
  for (const rule of RULES) {
    if (rule.forbid === null) continue;
    if (!rule.files.test(rel)) continue;
    if (isExempt(rel, rule.id)) continue;

    for (const match of source.matchAll(IMPORT_RE)) {
      const target = resolveSpecifier(file, match[1]);
      if (target === null) continue;
      // A directory import (`../motion` → `src/lib/motion`) resolves without a trailing slash
      // while the rule's `dir/` prefix requires one — so the barrel form bypasses the rule
      // entirely. Try both forms: `src/lib/motion` and `src/lib/motion/release` must get the
      // same verdict.
      if (!rule.forbid.test(target) && !rule.forbid.test(`${target}/`)) continue;
      // Report a repeated import of the same target only once, so one file does not flood the screen.
      const key = `${rule.id}|${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      report(rel, lineOf(source, match.index), `[${rule.id}] must not depend on ${target} — ${rule.why}`);
    }
  }
}

function checkMotionWrites(file, source) {
  const rel = relative(file);
  if (/^src\/lib\/motion\//.test(rel)) return;
  const rule = RULES.find((entry) => entry.id === 'L7');
  if (!rule.files.test(rel) || isExempt(rel, 'L7')) return;

  for (const { name, index } of findMotionWrites(source)) {
    report(
      rel,
      lineOf(source, index),
      `[L7] hand-written ${name} — ${rule.why} (compositing-layer promotion goes through src/lib/motion's promote()/release())`
    );
  }
}

/**
 * L9 — the overlay base rule must not carry its own z-index.
 *
 * `.dialog-overlay` and the `.z-*` bridge classes are both unlayered CSS with specificity
 * (0,1,0), so **the one that appears later wins overall**. Leaving a `z-index` in the base rule
 * silently overrides the caller's `zClassName` — the prop is indeed passed and the class is
 * indeed applied, only the stacking height is wrong: `--z-modal-secondary` (110) and `--z-tour`
 * (1100) both degrade to 100, below `@xyflow/react`'s selected node (1000), and the tour overlay
 * is penetrated by the node. This failure turns no test red and raises no error in the browser.
 *
 * So stacking may come only from an explicit bridge class (layers.css); the overlay itself gives
 * no default.
 */
function checkOverlayZIndex() {
  const rel = 'src/styles/components/dialog.css';
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return;
  const css = stripComments(fs.readFileSync(file, 'utf8'));
  for (const match of css.matchAll(/\.dialog-overlay\s*\{([^}]*)\}/g)) {
    if (!/(?:^|;)\s*z-index\s*:/.test(match[1])) continue;
    report(
      rel,
      lineOf(css, match.index),
      '[L9] `.dialog-overlay` must not declare z-index — it silently overrides the caller\'s `zClassName` ' +
        '(`.z-tour` 1100 / `.z-modal-secondary` 110 both degrade to 100); stacking comes only from the layers.css bridge classes'
    );
  }
}

function main() {
  for (const file of collect(SRC, ['.ts', '.tsx'])) {
    const rel = relative(file);
    // Tests may cross layers: fixtures and assertions need to see both sides at once, and what is
    // constrained is the direction of production code. Same treatment as the 500-line limit in
    // check-ui-tokens.mjs.
    if (rel.includes('__tests__') || /\.(?:test|spec)\.tsx?$/.test(rel)) continue;
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    checkImports(file, source);
    checkMotionWrites(file, source);
  }

  checkOverlayZIndex();

  if (errors.length > 0) {
    console.error(`frontend layering gate failed (${errors.length} items):\n`);
    for (const line of errors) console.error(`  ${line}`);
    console.error(
      '\nA reverse dependency turns no existing test red, it only adds one more surprise to the next change; it has to be stopped here.\n' +
        'The fix is to change the dependency, not to add an exemption — register the reason in EXEMPTIONS only for a genuinely bounded exception.'
    );
    process.exit(1);
  }

  const movable = EXEMPTIONS.filter((entry) => entry.movable).length;
  console.log(
    `frontend layering gate passed: no violation of ${RULES.length} rules; ` +
      `${EXEMPTIONS.length} exemptions (${movable} of them misplaced and removable by moving the target).`
  );
}

// Importing this module for its helpers (the self-test) must not run the gate.
const invokedPath = process.argv[1] === undefined ? null : path.resolve(process.argv[1]);
if (invokedPath !== null && invokedPath === fileURLToPath(import.meta.url)) main();

