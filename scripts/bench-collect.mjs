#!/usr/bin/env node
// Criterion 结果采集器：把 `target/criterion` 下的散落 JSON 归一成可提交的实验产物。
//
// 为什么需要它：Criterion 每个基准在 `<id>/new/estimates.json` 里各写一份统计量，
// 目录层级随 `benchmark_group` 嵌套而变化，人肉抄进论文既易错又无法复现。
// 这里只做"读 + 归一 + 导出"，不重新运行任何基准，因此可以随时对着上一次
// 运行结果重放，保证论文表格与仓库产物来自同一份原始数据。
//
// 用法:
//   node scripts/bench-collect.mjs                       # 采集到默认输出目录
//   node scripts/bench-collect.mjs --out docs/experiments/results
//   node scripts/bench-collect.mjs --json-log target/bench-audit/<ts>/soak-math.log
//   node scripts/bench-collect.mjs --check docs/experiments/results/criterion.json
//
// `--check` 把本次中位数与给定基线逐项比较，回归超过 `--tolerance`（默认 25%）
// 即非零退出，作为可选性能门禁。

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const defaultCriterion = join(repoRoot, 'src-tauri', 'target', 'criterion');
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
      if (value === undefined) throw new Error(`${arg} 缺少取值`);
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
        throw new Error(`未知参数: ${arg}`);
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

/** Criterion 的 throughput 声明，用于把耗时换算成吞吐。 */
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
      console.warn(`跳过无法解析的估计: ${estimateFile} (${error.message})`);
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
 * 非 Criterion 基准（`harness = false` 的自定义 `main`）把结果按行打成 JSON。
 * 这里逐行解析，保留每份日志的来源，避免不同场景的结果混在一起无法追溯。
 */
function collectJsonLogs(logFiles) {
  const logs = [];
  for (const logFile of logFiles) {
    if (!existsSync(logFile)) {
      console.warn(`基准日志不存在: ${logFile}`);
      continue;
    }
    const entries = [];
    for (const line of readFileSync(logFile, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch {
        // 非 JSON 行（cargo 进度、criterion 输出）直接忽略。
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
    console.warn(`基线不存在，跳过比较: ${baselinePath}`);
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
      `性能回归: ${row.id} 中位数 ${(row.baseline_ns / 1000).toFixed(2)}µs -> ${(row.current_ns / 1000).toFixed(2)}µs (+${pct}%, 容差 ${(tolerance * 100).toFixed(0)}%)`,
    );
  }
  if (missing.length > 0) {
    console.warn(`基线缺失 ${missing.length} 项（不判失败）: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' ...' : ''}`);
  }
  return regressions.length;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('用法: node scripts/bench-collect.mjs [--criterion DIR] [--out DIR] [--json-log LOG]... [--label NAME] [--check BASELINE] [--tolerance R]');
    return 0;
  }
  if (!existsSync(options.criterion)) {
    console.error(`Criterion 输出目录不存在: ${options.criterion}\n先运行 bash scripts/bench-audit.sh quick 生成结果。`);
    return 1;
  }

  const benchmarks = collectCriterion(options.criterion);
  const harnessLogs = collectJsonLogs(options.jsonLogs);
  const jsonPath = join(options.out, 'criterion.json');
  // 未显式传 --label 时沿用上一次的标签：--check 会重写产物，若标签被清空，
  // "本次产物来自哪一次采集"这条线索就丢了。
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
    console.log(`采集 ${benchmarks.length} 项基准 -> ${relative(repoRoot, jsonPath)}`);
    console.log(`CSV -> ${relative(repoRoot, csvPath)}`);
    if (harnessLogs.length > 0) console.log(`非 Criterion 基准日志 ${harnessLogs.length} 份 -> ${relative(repoRoot, join(options.out, 'harness.json'))}`);
  }

  if (options.check) {
    const regressions = compareToBaseline(benchmarks, options.check, options.tolerance);
    if (regressions > 0) return 1;
  }
  return 0;
}

process.exitCode = main();
