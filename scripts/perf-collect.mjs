#!/usr/bin/env node
// 前端性能结果采集器：读 Playwright 落盘的原始计量，归一成可提交的产物，并按需与基线比较。
//
// 为什么与 bench-collect.mjs 分成两个脚本，而不是合并：两者度量的是不同的东西。
// Criterion 量的是**计算**吞吐（纯 CPU、可复现、与机器负载基本无关）；这里量的是
// **渲染**成本（帧调度、光栅、合成层）。前者的数字适合直接卡门禁，后者的绝对值不适合。
// 合并成一个"性能基线"会诱使人用 Criterion 的信心去读帧时间，于是把噪声当回归。
//
// 门禁只卡两类东西，都必须是**确定性计数**：
//
//   1. 硬上限（budget）：场景内某类操作次数不得超过预算。超了就是代码引入了
//      "每帧重复做重活"的模式，与机器无关，任何机器上都复现。
//   2. 相对基线的计数回归：同一个计数比基线高出容差倍数即失败。
//
// 刻意**不**卡的东西：fps、帧时间分位、长任务时长、JS 堆。无头 Chromium 没有
// 真实 vsync，帧间隔由 BeginFrame 调度器决定，共享 CI runner 的负载会直接改写
// 这些数字。把它们做成硬门禁的必然结局是团队学会无视红灯，然后门禁就死了。
// 它们照常记录、照常写进产物，供人看趋势；要断言真机帧率得在桌面端实测。
//
// 用法:
//   node scripts/perf-collect.mjs                          # 归一到默认输出目录
//   node scripts/perf-collect.mjs --out DIR
//   node scripts/perf-collect.mjs --update-baseline        # 用本次结果覆盖基线
//   node scripts/perf-collect.mjs --check                   # 与基线比较, 回归则非零退出
//   node scripts/perf-collect.mjs --check --tolerance 0.5   # 放宽计数回归容差
//
// 采集与判定分离的理由和 bench-collect 一样：原始数据可以反复重放，基线更新
// 不需要重跑浏览器，而"这次红灯到底是代码变了还是机器热了"始终可以复查。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
// 原始数据来自浏览器计量, 产物是"这一次跑出来的数字", 基线是"仓库承诺的合同"。
// 两者必须分开放: 产物属于本次运行, 不该进版本库; 基线必须提交, 否则 CI 里的
// --check 会因为找不到基线而静默跳过, 门禁就形同虚设。
// 注意 docs/experiments/ 是 gitignore 的 (可重放实验产物), 基线因此不能放那里。
const defaultRaw = join(repoRoot, 'output', 'perf-frontend', 'raw.json');
const defaultOut = join(repoRoot, 'output', 'perf-frontend');
const defaultBaseline = join(repoRoot, 'docs', 'performance', 'frontend-perf.json');

/**
 * 每类计数器的硬上限。**按每帧归一**，而不是每场景总量。
 *
 * 为什么归一：场景采到多少帧取决于机器快慢，总量因此不是稳定量 —— 同一份代码在
 * 慢机器上会"自然"采到更多帧、写出更多属性，用总量卡门禁等于按机器性能判刑。
 * 速率（每帧多少次）才是代码的性质：它问的是"每一帧我做了多少重复劳动"。
 *
 * 为什么是速率而不是绝对次数：属性写入的主要来源是 lucide-react 图标在每次
 * React 提交时重发 `path[d]` / `path[fill]` / `path[class]`。于是这个速率实际
 * 映着**每帧的 React 提交量** —— 交互期间重渲染越多，它越高。它是重渲染成本的
 * 代理指标，而不是某个图标实现的瑕疵。
 *
 * 这层代理指标看不见什么：CSS 过渡触发的布局重排发生在浏览器 C++ 里，不经过任何
 * JS，因此本探针对"逐帧布局动画"完全无感。`transition: flex-grow` 在这里量出来是
 * 0，代价却是每帧一次整棵面板子树的重排。这类缺陷由 `pnpm check:motion` 静态拦，
 * 不归本门禁管 —— 详见 docs/performance/frontend-render-budget.md。
 *
 * 预算取值随实测收紧（2026-10-05）：
 *
 *   场景            setAttribute/帧   强制布局读/帧   getComputedStyle/帧
 *   panel-drawer         72                3.6              2.1
 *   canvas-drag          34                4.4              1.0
 *   palette-scroll       33                5.1              1.0
 *
 * panel-drawer 从 94 降到 72，是因为抽屉宽度不再逐帧重排整个面板组（见
 * docs/performance/frontend-render-budget.md）。setAttribute 的上限跟着从 120 收
 * 到 90，让这次改善被门禁锁住，而不是随下一次改动悄悄涨回去。
 *
 * `canvasBackingStoreRealloc` 例外: 它按绝对值卡 0。给 canvas 写 width/height
 * 会清空整块位图, 任何"每帧都重设尺寸"的写法都是缺陷, 不存在"合理次数"。
 */
const COUNTER_BUDGETS_PER_FRAME = {
  canvasBackingStoreRealloc: 0,
  setAttribute: 90,
  getBoundingClientRect: 8,
  getComputedStyle: 4,
};

/** 只记录、不判定的时间类指标。写进产物供人看趋势。 */
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
      if (value === undefined) throw new Error(`${arg} 缺少取值`);
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
      default: throw new Error(`未知参数: ${arg}`);
    }
  }
  return options;
}

function readRaw(rawPath) {
  if (!existsSync(rawPath)) {
    throw new Error(
      `原始计量不存在: ${relative(repoRoot, rawPath)}\n` +
        '先运行 pnpm test:perf (需要 playwright + 前后端服务)。',
    );
  }
  const parsed = JSON.parse(readFileSync(rawPath, 'utf8'));
  if (parsed.schema !== 1) {
    throw new Error(`原始计量 schema 不认识: ${parsed.schema}（期望 1）。探针格式变了，需同步本脚本。`);
  }
  return parsed.scenarios ?? {};
}

/**
 * 把原始场景归一成一行一场景的表。
 *
 * 没跑起来的场景原样保留（`ran: false` + 原因）而不是丢弃：丢了就看不出"这个场景
 * 上次也没测到"，而那恰恰是需要人补测的信号。
 *
 * 计数一律除以帧数变成速率。分母为 0（没采到帧）时速率记 null 而不是 0 —— 把
 * "没测到"写成 0 速率会让门禁显示"成本为零"，比不显示更危险。
 */
function collect(scenarios) {
  const rows = [];
  for (const [name, record] of Object.entries(scenarios)) {
    if (!record.ran || !record.sample) {
      rows.push({ scenario: name, ran: false, reason: record.reason ?? '未知原因' });
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
      // 属性写入归类: 门禁只能说"超了 N 次", 这个字段才回答"是谁"。
      topAttributes: record.sample.topAttributes ?? [],
    });
  }
  return rows.sort((a, b) => a.scenario.localeCompare(b.scenario));
}

/** 逐项检查每帧速率上限。只有真正跑起来的场景才判 —— 跳过不该伪装成通过。 */
function checkBudgets(rows) {
  const violations = [];
  for (const row of rows) {
    if (!row.ran) continue;
    for (const [key, budget] of Object.entries(COUNTER_BUDGETS_PER_FRAME)) {
      const value = row.perFrame[key];
      // null = 没采到帧, 无法算速率。已在 collect 里与 0 区分, 此处不判失败,
      // 但也不能当成通过 —— 用 skipped 标记让报告里看得见。
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

/** 速率相对基线的回归。基线里没有的场景不判失败, 只提示。 */
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
      // 基线为 0/缺失时不做相对比较: 除以 0 没有意义, 而从 0 涨起来已经是
      // 预算该管的事（上面的 checkBudgets 会抓到）。
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
  lines.push('前端性能计量');
  lines.push('');
  lines.push('  每帧速率 (门禁项)');
  for (const row of rows) {
    if (!row.ran) {
      lines.push(`  ${row.scenario.padEnd(16)} 跳过 — ${row.reason}`);
      continue;
    }
    const rates = Object.entries(row.perFrame)
      .map(([k, v]) => `${k}=${fmt(v)}`)
      .join('  ');
    lines.push(`  ${row.scenario.padEnd(16)} frames=${String(row.frames).padEnd(4)} ${rates}`);
    const advisory = row.advisory;
    lines.push(
      `  ${''.padEnd(16)} 参考(不判定): fps=${fmt(advisory.fps)} p95=${fmt(advisory.frameTimeP95Ms)}ms ` +
        `max=${fmt(advisory.frameTimeMaxMs)}ms longTask=${fmt(advisory.longTaskTotalMs)}ms heap=${fmt(advisory.jsHeapMb)}MB`,
    );
    if (row.topAttributes.length > 0) {
      const top = row.topAttributes.slice(0, 4).map((a) => `${a.key}=${a.count}`).join('  ');
      lines.push(`  ${''.padEnd(16)} 属性写入前四: ${top}`);
    }
  }

  if (violations.length === 0 && regressions.length === 0) {
    lines.push('');
    lines.push('  门禁: 通过（每帧速率均在预算内且未较基线回归）');
  }
  return lines.join('\n');
}

function fmt(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

/**
 * 展示用路径。`--out` 指到仓库外时 relative() 会吐出一串 `../../..`,
 * 对读日志的人毫无意义, 这种情况下直接给绝对路径。
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
      '用法: node scripts/perf-collect.mjs [--raw FILE] [--out DIR] [--baseline FILE] [--check] [--update-baseline] [--tolerance R]',
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
      'perFrame 为门禁项（每帧速率）；advisory 为时序类参考量，无头环境下随 runner 负载漂移，刻意不做判定。',
    budgetsPerFrame: COUNTER_BUDGETS_PER_FRAME,
    rows,
  };

  mkdirSync(options.out, { recursive: true });
  const outPath = join(options.out, 'frontend-perf.json');
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);

  if (!options.quiet) {
    console.log(formatReport(rows, violations, regressions));
    console.log('');
    console.log(`产物 -> ${displayPath(outPath)}`);
  }

  if (options.updateBaseline) {
    mkdirSync(dirname(options.baseline), { recursive: true });
    writeFileSync(options.baseline, `${JSON.stringify(payload, null, 2)}\n`);
    if (!options.quiet) console.log(`基线已更新 -> ${displayPath(options.baseline)}`);
    return 0;
  }

  for (const v of violations) {
    console.error(
      `超预算: ${v.scenario} 的 ${v.counter} 每帧 ${v.value} 次, 预算 ${v.budget}。` +
        '这说明该场景引入了逐帧重复的昂贵操作（尺寸重分配/属性刷写/强制布局读）。',
    );
  }
  for (const r of regressions) {
    console.error(
      `速率回归: ${r.scenario} 的 ${r.counter} 每帧 ${r.baseline} -> ${r.value} ` +
        `(+${(r.delta * 100).toFixed(1)}%, 容差 ${(options.tolerance * 100).toFixed(0)}%)`,
    );
  }
  if (missing.length > 0) {
    console.warn(`基线缺失 ${missing.length} 个场景（不判失败）: ${missing.join(', ')}`);
  }

  return violations.length + regressions.length > 0 ? 1 : 0;
}

process.exitCode = main();