#!/usr/bin/env node
// Frontend performance result collector: reads the raw measurements Playwright wrote to disk, normalizes them into a committable artifact, and optionally compares against the baseline.
//
// Why this is a separate script from bench-collect.mjs rather than merged: the two measure
// different things. Criterion measures **compute** throughput (pure CPU, reproducible, largely
// independent of machine load); this measures **render** cost (frame scheduling, rasterization,
// compositing layers). The former's numbers suit a hard gate; the latter's absolute values do not.
// Merging them into one "performance baseline" would tempt people to read frame times with
// Criterion-grade confidence, and treat noise as a regression.
//
// The gate checks only two kinds of things, and both must be **deterministic counts**:
//
//   1. Hard budget: the number of a given operation within a scenario must not exceed the budget.
//      Exceeding it means the code introduced a "redo heavy work every frame" pattern, which is
//      machine-independent and reproduces on any machine.
//   2. Count regression against the baseline: the same count exceeding the baseline by the tolerance factor fails.
//
// Deliberately **not** gated: fps, frame-time percentiles, long-task duration, JS heap. Headless
// Chromium has no real vsync — frame intervals are decided by the BeginFrame scheduler — and load
// on a shared CI runner directly rewrites these numbers. Making them a hard gate inevitably ends
// with the team learning to ignore red lights, and then the gate is dead. They are still recorded
// and still written to the artifact for people to watch trends; asserting real-machine frame rate
// requires measuring on the desktop build.
//
// Usage:
//   node scripts/perf-collect.mjs                          # normalize into the default output directory
//   node scripts/perf-collect.mjs --out DIR
//   node scripts/perf-collect.mjs --update-baseline        # overwrite the baseline with this run's results
//   node scripts/perf-collect.mjs --check                   # compare against the baseline, exit non-zero on regression
//   node scripts/perf-collect.mjs --check --tolerance 0.5   # loosen the count-regression tolerance
//
// The reason to separate collection from judging is the same as for bench-collect: raw data can be
// replayed repeatedly, updating the baseline does not require re-running the browser, and "was this
// red light the code changing or the machine running hot" can always be re-checked.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
// Raw data comes from browser measurement; the artifact is "the numbers from this run", and the
// baseline is "the contract the repository commits to". The two must live apart: the artifact
// belongs to this run and must not enter version control; the baseline must be committed, or
// --check in CI silently skips when it cannot find the baseline and the gate is an empty shell.
// Note docs/experiments/ is gitignored (replayable experiment artifacts), so the baseline cannot go there.
const defaultRaw = join(repoRoot, 'output', 'perf-frontend', 'raw.json');
const defaultOut = join(repoRoot, 'output', 'perf-frontend');
const defaultBaseline = join(repoRoot, 'docs', 'performance', 'frontend-perf.json');

/**
 * Hard per-counter budgets. **Normalized per frame**, not per-scenario totals.
 *
 * Why normalize: how many frames a scenario captures depends on machine speed, so the total is
 * not a stable quantity — the same code "naturally" captures more frames and writes more
 * attributes on a slow machine, and gating on totals amounts to sentencing a machine for its
 * performance. The rate (how many per frame) is a property of the code: it asks "how much
 * repeated work do I do on each frame".
 *
 * Why a rate rather than an absolute count: the main source of attribute writes is lucide-react
 * icons re-emitting `path[d]` / `path[fill]` / `path[class]` on every React commit. So this rate
 * actually reflects **the per-frame React commit volume** — the more re-renders during
 * interaction, the higher it goes. It is a proxy for re-render cost, not a flaw in some icon
 * implementation.
 *
 * What this proxy cannot see: layout thrash triggered by CSS transitions happens in browser C++,
 * never passing through JS, so this probe is completely blind to "per-frame layout animation".
 * `transition: flex-grow` measures as 0 here, yet costs a re-layout of the whole panel subtree
 * every frame. Such defects are caught statically by `pnpm check:motion` and are not this gate's
 * business — see client/docs/performance/frontend-render-budget.md.
 *
 * Budgets tightened with measurement (2026-10-05):
 *
 *   scenario          setAttribute/frame   forced layout reads/frame   getComputedStyle/frame
 *   panel-drawer             72                    3.6                        2.1
 *   canvas-drag              34                    4.4                        1.0
 *   palette-scroll           33                    5.1                        1.0
 *
 * panel-drawer dropped from 94 to 72 because the drawer width no longer re-lays-out the whole
 * panel group every frame (see client/docs/performance/frontend-render-budget.md). The setAttribute
 * ceiling followed from 120 down to 90, so this improvement is locked in by the gate instead of
 * quietly creeping back up with the next change.
 *
 * `canvasBackingStoreRealloc` is the exception: it is gated at an absolute 0. Writing
 * width/height to a canvas clears the whole bitmap, so any "resize every frame" pattern is a
 * defect; there is no "reasonable count".
 */
const COUNTER_BUDGETS_PER_FRAME = {
  canvasBackingStoreRealloc: 0,
  setAttribute: 90,
  getBoundingClientRect: 8,
  getComputedStyle: 4,
};

/** Time-based metrics that are recorded but never judged. Written to the artifact for trend-watching. */
const ADVISORY_METRICS = [
  'fps',
  'frameTimeP95Ms',
  'frameTimeMaxMs',
  'longTaskTotalMs',
  'longestTaskMs',
  'jsHeapMb',
];

function parseArgs(argv) {
  const options = {
    raw: defaultRaw,
    out: defaultOut,
    check: false,
    updateBaseline: false,
    baseline: defaultBaseline,
    tolerance: 0.5,
    quiet: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} is missing a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--raw': options.raw = resolve(repoRoot, next()); break;
      case '--out': options.out = resolve(repoRoot, next()); break;
      case '--baseline': options.baseline = resolve(repoRoot, next()); break;
      case '--check': options.check = true; break;
      case '--update-baseline': options.updateBaseline = true; break;
      case '--tolerance': options.tolerance = Number(next()); break;
      case '--quiet': options.quiet = true; break;
      case '--help': options.help = true; break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function readRaw(rawPath) {
  if (!existsSync(rawPath)) {
    throw new Error(
      `raw measurements not found: ${relative(repoRoot, rawPath)}\n` +
        'run pnpm test:perf first (requires playwright + the frontend and backend services).',
    );
  }
  const parsed = JSON.parse(readFileSync(rawPath, 'utf8'));
  if (parsed.schema !== 1) {
    throw new Error(`unrecognized raw-measurement schema: ${parsed.schema} (expected 1). The probe format changed; this script must be updated.`);
  }
  return parsed.scenarios ?? {};
}

/**
 * Normalize the raw scenarios into one row per scenario.
 *
 * Scenarios that did not run are kept as-is (`ran: false` + reason) rather than dropped:
 * dropping them would hide "this scenario was not measured last time either", and that is
 * exactly the signal a human needs to re-measure.
 *
 * Counts are always divided by the frame count to become rates. When the denominator is 0 (no
 * frames captured) the rate is recorded as null rather than 0 — writing "not measured" as a
 * rate of 0 would make the gate show "zero cost", which is more dangerous than showing nothing.
 */
function collect(scenarios) {
  const rows = [];
  for (const [name, record] of Object.entries(scenarios)) {
    if (!record.ran || !record.sample) {
      rows.push({ scenario: name, ran: false, reason: record.reason ?? 'unknown reason' });
      continue;
    }
    const frames = record.sample.frames ?? 0;
    const perFrame = {};
    const totals = {};
    for (const key of Object.keys(COUNTER_BUDGETS_PER_FRAME)) {
      const total = record.sample[key] ?? 0;
      totals[key] = total;
      perFrame[key] = frames > 0 ? Number((total / frames).toFixed(2)) : null;
    }
    const advisory = {};
    for (const key of ADVISORY_METRICS) advisory[key] = record.sample[key] ?? null;
    rows.push({
      scenario: name,
      ran: true,
      frames,
      totals,
      perFrame,
      advisory,
      // Attribute-write breakdown: the gate can only say "exceeded by N"; this field answers "which ones".
      topAttributes: record.sample.topAttributes ?? [],
    });
  }
  return rows.sort((a, b) => a.scenario.localeCompare(b.scenario));
}

/** Check each per-frame rate ceiling. Only scenarios that actually ran are judged — skipped must not masquerade as passed. */
function checkBudgets(rows) {
  const violations = [];
  for (const row of rows) {
    if (!row.ran) continue;
    for (const [key, budget] of Object.entries(COUNTER_BUDGETS_PER_FRAME)) {
      const value = row.perFrame[key];
      // null = no frames captured, so no rate can be computed. collect already distinguishes it from 0;
      // do not fail here, but do not treat it as passing either — mark it skipped so the report shows it.
      if (value === null) continue;
      if (value > budget) {
        violations.push({
          scenario: row.scenario,
          counter: key,
          budget,
          value,
          kind: 'budget',
        });
      }
    }
  }
  return violations;
}

/** Rate regressions against the baseline. Scenarios absent from the baseline are not failed, only flagged. */
function compareCounters(rows, baselinePath, tolerance) {
  if (!existsSync(baselinePath)) return { regressions: [], missing: [] };
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const baseByScenario = new Map((baseline.rows ?? []).map((r) => [r.scenario, r]));
  const regressions = [];
  const missing = [];
  for (const row of rows) {
    if (!row.ran) continue;
    const base = baseByScenario.get(row.scenario);
    if (!base?.ran) {
      missing.push(row.scenario);
      continue;
    }
    for (const [key, value] of Object.entries(row.perFrame)) {
      const baseValue = base.perFrame?.[key];
      // Skip relative comparison when the baseline is 0/missing: dividing by 0 is meaningless, and a
      // rise from 0 is already the budget's business (checkBudgets above catches it).
      if (!(baseValue > 0) || value === null) continue;
      const delta = (value - baseValue) / baseValue;
      if (delta > tolerance) {
        regressions.push({ scenario: row.scenario, counter: key, baseline: baseValue, value, delta, kind: 'counter' });
      }
    }
  }
  return { regressions, missing };
}

function formatReport(rows, violations, regressions) {
  const lines = [];
  lines.push('Frontend performance measurements');
  lines.push('');
  lines.push('  Per-frame rates (gated)');
  for (const row of rows) {
    if (!row.ran) {
      lines.push(`  ${row.scenario.padEnd(16)} skipped — ${row.reason}`);
      continue;
    }
    const rates = Object.entries(row.perFrame)
      .map(([k, v]) => `${k}=${fmt(v)}`)
      .join('  ');
    lines.push(`  ${row.scenario.padEnd(16)} frames=${String(row.frames).padEnd(4)} ${rates}`);
    const advisory = row.advisory;
    lines.push(
      `  ${''.padEnd(16)} advisory (not judged): fps=${fmt(advisory.fps)} p95=${fmt(advisory.frameTimeP95Ms)}ms ` +
        `max=${fmt(advisory.frameTimeMaxMs)}ms longTask=${fmt(advisory.longTaskTotalMs)}ms heap=${fmt(advisory.jsHeapMb)}MB`,
    );
    if (row.topAttributes.length > 0) {
      const top = row.topAttributes.slice(0, 4).map((a) => `${a.key}=${a.count}`).join('  ');
      lines.push(`  ${''.padEnd(16)} top attribute writes: ${top}`);
    }
  }

  if (violations.length === 0 && regressions.length === 0) {
    lines.push('');
    lines.push('  Gate: passed (every per-frame rate is within budget and none regressed against the baseline)');
  }
  return lines.join('\n');
}

function fmt(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

/**
 * Path for display. When `--out` points outside the repository, relative() emits a string of
 * `../../..` that means nothing to someone reading the log, so give the absolute path in that case.
 */
function displayPath(target) {
  const rel = relative(repoRoot, target);
  return rel.startsWith('..') ? target : rel;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  if (options.help) {
    console.log(
      'Usage: node scripts/perf-collect.mjs [--raw FILE] [--out DIR] [--baseline FILE] [--check] [--update-baseline] [--tolerance R]',
    );
    return 0;
  }

  let scenarios;
  try {
    scenarios = readRaw(options.raw);
  } catch (error) {
    console.error(error.message);
    return 1;
  }

  const rows = collect(scenarios);
  const violations = checkBudgets(rows);

  let regressions = [];
  let missing = [];
  if (options.check) {
    const compared = compareCounters(rows, options.baseline, options.tolerance);
    regressions = compared.regressions;
    missing = compared.missing;
  }

  const payload = {
    schema: 1,
    note:
      'perFrame are the gated numbers (per-frame rates); advisory are timing reference values that drift with runner load in a headless environment and are deliberately not judged.',
    budgetsPerFrame: COUNTER_BUDGETS_PER_FRAME,
    rows,
  };

  mkdirSync(options.out, { recursive: true });
  const outPath = join(options.out, 'frontend-perf.json');
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);

  if (!options.quiet) {
    console.log(formatReport(rows, violations, regressions));
    console.log('');
    console.log(`artifact -> ${displayPath(outPath)}`);
  }

  if (options.updateBaseline) {
    mkdirSync(dirname(options.baseline), { recursive: true });
    writeFileSync(options.baseline, `${JSON.stringify(payload, null, 2)}\n`);
    if (!options.quiet) console.log(`baseline updated -> ${displayPath(options.baseline)}`);
    return 0;
  }

  for (const v of violations) {
    console.error(
      `over budget: ${v.scenario} ${v.counter} ${v.value} per frame, budget ${v.budget}. ` +
        'This means the scenario introduced a repeated per-frame expensive operation (size reallocation / attribute writes / forced layout reads).',
    );
  }
  for (const r of regressions) {
    console.error(
      `rate regression: ${r.scenario} ${r.counter} ${r.baseline} -> ${r.value} per frame ` +
        `(+${(r.delta * 100).toFixed(1)}%, tolerance ${(options.tolerance * 100).toFixed(0)}%)`,
    );
  }
  if (missing.length > 0) {
    console.warn(`baseline missing ${missing.length} scenario(s) (not a failure): ${missing.join(', ')}`);
  }

  return violations.length + regressions.length > 0 ? 1 : 0;
}

process.exitCode = main();