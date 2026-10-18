#!/usr/bin/env node
// Criterion result collector: normalize the scattered JSON under `target/criterion` into a
// committable experiment artifact.
//
// Why it exists: Criterion writes one set of statistics per benchmark into
// `<id>/new/estimates.json`, and the directory nesting varies with `benchmark_group`, so
// copying them into the paper by hand is both error-prone and irreproducible. This only
// "reads + normalizes + exports" and never re-runs a benchmark, so it can be replayed
// against the previous run's results at any time, keeping the paper tables and the
// repository artifacts on the same raw data.
//
// Usage:
//   node scripts/bench-collect.mjs                       # collect into the default output directory
//   node scripts/bench-collect.mjs --out docs/experiments/results
//   node scripts/bench-collect.mjs --json-log target/bench-audit/<ts>/soak-math.log
//   node scripts/bench-collect.mjs --check docs/experiments/results/criterion.json
//
// `--check` compares this run's medians item by item against the given baseline and exits
// non-zero when the regression exceeds `--tolerance` (default 25%), as an optional
// performance gate.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const defaultCriterion = join(repoRoot, 'server', 'target', 'criterion');
const defaultOut = join(repoRoot, 'docs', 'experiments', 'results');

function parseArgs(argv) {
  const options = {
    criterion: defaultCriterion,
    out: defaultOut,
    jsonLogs: [],
    label: null,
    check: null,
    tolerance: 0.25,
    quiet: false,
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
      case '--criterion':
        options.criterion = resolve(repoRoot, next());
        break;
      case '--out':
        options.out = resolve(repoRoot, next());
        break;
      case '--json-log':
        options.jsonLogs.push(resolve(repoRoot, next()));
        break;
      case '--label':
        options.label = next();
        break;
      case '--check':
        options.check = resolve(repoRoot, next());
        break;
      case '--tolerance':
        options.tolerance = Number(next());
        break;
      case '--quiet':
        options.quiet = true;
        break;
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function walk(dir, predicate, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, predicate, acc);
    } else if (predicate(full)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Criterion's throughput declaration, used to convert duration into throughput. */
function readThroughput(benchmarkFile) {
  if (!existsSync(benchmarkFile)) return null;
  try {
    const parsed = JSON.parse(readFileSync(benchmarkFile, 'utf8'));
    return parsed.throughput ?? null;
  } catch {
    return null;
  }
}

function throughputPerSecond(throughput, medianNs) {
  if (!throughput || !(medianNs > 0)) return null;
  const seconds = medianNs / 1e9;
  const amount = throughput.Bytes ?? throughput.Elements ?? null;
  if (amount === null) return null;
  return {
    unit: throughput.Bytes !== undefined ? 'bytes/s' : 'elements/s',
    value: amount / seconds,
  };
}

function collectCriterion(criterionDir) {
  const estimateFiles = walk(criterionDir, (file) => file.endsWith(`${sep}new${sep}estimates.json`));
  const rows = [];
  for (const estimateFile of estimateFiles) {
    const id = relative(criterionDir, dirname(dirname(estimateFile))).split(sep).join('/');
    let estimates;
    try {
      estimates = JSON.parse(readFileSync(estimateFile, 'utf8'));
    } catch (error) {
      console.warn(`skipping unparsable estimate: ${estimateFile} (${error.message})`);
      continue;
    }
    const medianNs = estimates.median?.point_estimate ?? null;
    const meanNs = estimates.mean?.point_estimate ?? null;
    const throughput = readThroughput(join(dirname(estimateFile), 'benchmark.json'));
    const rate = throughputPerSecond(throughput, medianNs);
    const segments = id.split('/');
    rows.push({
      id,
      group: segments.length > 1 ? segments.slice(0, -1).join('/') : segments[0],
      function: segments.at(-1),
      median_ns: medianNs,
      median_lower_ns: estimates.median?.confidence_interval?.lower_bound ?? null,
      median_upper_ns: estimates.median?.confidence_interval?.upper_bound ?? null,
      mean_ns: meanNs,
      std_dev_ns: estimates.std_dev?.point_estimate ?? null,
      median_abs_dev_ns: estimates.median_abs_dev?.point_estimate ?? null,
      throughput,
      throughput_per_s: rate ? rate.value : null,
      throughput_unit: rate ? rate.unit : null,
      source: relative(repoRoot, estimateFile),
    });
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

/**
 * Non-Criterion benchmarks (a custom `main` with `harness = false`) print their results as
 * one JSON object per line. Parse line by line here and keep each log's origin, so results
 * from different scenarios cannot mix and become untraceable.
 */
function collectJsonLogs(logFiles) {
  const logs = [];
  for (const logFile of logFiles) {
    if (!existsSync(logFile)) {
      console.warn(`benchmark log does not exist: ${logFile}`);
      continue;
    }
    const entries = [];
    for (const line of readFileSync(logFile, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch {
        // Non-JSON lines (cargo progress, criterion output) are ignored.
      }
    }
    if (entries.length === 0) continue;
    logs.push({ source: relative(repoRoot, logFile), entries });
  }
  return logs;
}

function runCapture(command, args) {
  try {
    return execFileSync(command, args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function collectEnvironment() {
  const cpus = runCapture('sysctl', ['-n', 'machdep.cpu.brand_string']);
  const cores = runCapture('sysctl', ['-n', 'hw.ncpu']);
  const memoryBytes = runCapture('sysctl', ['-n', 'hw.memsize']);
  return {
    captured_at: new Date().toISOString(),
    os: `${runCapture('uname', ['-s']) ?? 'unknown'} ${runCapture('uname', ['-r']) ?? ''}`.trim(),
    cpu: cpus,
    cores: cores ? Number(cores) : null,
    memory_gib: memoryBytes ? Number(memoryBytes) / 1024 ** 3 : null,
    rustc: runCapture('rustc', ['--version']),
    cargo: runCapture('cargo', ['--version']),
    git_rev: runCapture('git', ['rev-parse', '--short', 'HEAD']),
    git_dirty: (runCapture('git', ['status', '--porcelain']) ?? '') !== '',
    profile: 'bench (CARGO_PROFILE_BENCH_DEBUG=0)',
  };
}

const CSV_COLUMNS = [
  'id',
  'median_ns',
  'median_lower_ns',
  'median_upper_ns',
  'mean_ns',
  'std_dev_ns',
  'median_abs_dev_ns',
  'throughput_kind',
  'throughput_amount',
  'throughput_per_s',
  'throughput_unit',
];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      CSV_COLUMNS.map((column) => {
        if (column === 'throughput_kind') return csvCell(row.throughput ? Object.keys(row.throughput)[0] : null);
        if (column === 'throughput_amount') {
          return csvCell(row.throughput ? (row.throughput.Bytes ?? row.throughput.Elements ?? null) : null);
        }
        return csvCell(row[column]);
      }).join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

function compareToBaseline(current, baselinePath, tolerance) {
  if (!existsSync(baselinePath)) {
    console.warn(`baseline does not exist, skipping comparison: ${baselinePath}`);
    return 0;
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const baselineById = new Map((baseline.benchmarks ?? []).map((row) => [row.id, row]));
  const regressions = [];
  const missing = [];
  for (const row of current) {
    const base = baselineById.get(row.id);
    if (!base) {
      missing.push(row.id);
      continue;
    }
    if (!(base.median_ns > 0) || !(row.median_ns > 0)) continue;
    const delta = (row.median_ns - base.median_ns) / base.median_ns;
    if (delta > tolerance) {
      regressions.push({ id: row.id, baseline_ns: base.median_ns, current_ns: row.median_ns, delta });
    }
  }
  for (const row of regressions) {
    const pct = (row.delta * 100).toFixed(1);
    console.error(
      `performance regression: ${row.id} median ${(row.baseline_ns / 1000).toFixed(2)}µs -> ${(row.current_ns / 1000).toFixed(2)}µs (+${pct}%, tolerance ${(tolerance * 100).toFixed(0)}%)`,
    );
  }
  if (missing.length > 0) {
    console.warn(`baseline is missing ${missing.length} entries (not treated as failure): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' ...' : ''}`);
  }
  return regressions.length;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('usage: node scripts/bench-collect.mjs [--criterion DIR] [--out DIR] [--json-log LOG]... [--label NAME] [--check BASELINE] [--tolerance R]');
    return 0;
  }
  if (!existsSync(options.criterion)) {
    console.error(`Criterion output directory does not exist: ${options.criterion}\nRun bash scripts/bench-audit.sh quick first to generate results.`);
    return 1;
  }

  const benchmarks = collectCriterion(options.criterion);
  const harnessLogs = collectJsonLogs(options.jsonLogs);
  const jsonPath = join(options.out, 'criterion.json');
  // When --label is not passed explicitly, keep the previous label: --check rewrites the
  // artifact, and clearing the label would lose the clue of which collection run this
  // artifact came from.
  let label = options.label;
  if (label === null && existsSync(jsonPath)) {
    try {
      label = JSON.parse(readFileSync(jsonPath, 'utf8')).label ?? null;
    } catch {
      label = null;
    }
  }
  const payload = {
    label,
    environment: collectEnvironment(),
    criterion_dir: relative(repoRoot, options.criterion),
    benchmark_count: benchmarks.length,
    benchmarks,
    harness_log_count: harnessLogs.length,
    harness_logs: harnessLogs,
  };

  mkdirSync(options.out, { recursive: true });
  const csvPath = join(options.out, 'criterion.csv');
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(csvPath, toCsv(benchmarks));
  if (harnessLogs.length > 0) {
    writeFileSync(
      join(options.out, 'harness.json'),
      `${JSON.stringify({ environment: payload.environment, logs: harnessLogs }, null, 2)}\n`,
    );
  }

  if (!options.quiet) {
    console.log(`collected ${benchmarks.length} benchmarks -> ${relative(repoRoot, jsonPath)}`);
    console.log(`CSV -> ${relative(repoRoot, csvPath)}`);
    if (harnessLogs.length > 0) console.log(`non-Criterion benchmark logs: ${harnessLogs.length} -> ${relative(repoRoot, join(options.out, 'harness.json'))}`);
  }

  if (options.check) {
    const regressions = compareToBaseline(benchmarks, options.check, options.tolerance);
    if (regressions > 0) return 1;
  }
  return 0;
}

process.exitCode = main();
