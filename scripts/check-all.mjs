#!/usr/bin/env node
/**
 * check-all.mjs — one-shot formatting + full quality gate
 *
 * Why this is a Node script: the tier command in `scripts/gates.mjs` and the
 * workflows invoke `scripts/check-all.sh`, but that shell is not guaranteed on a
 * Windows checkout, where `pnpm check:all` then fails before a single gate runs.
 * The driver therefore lives here — one implementation for the Linux CI checkout
 * and for Windows — and `scripts/check-all.sh` is a shim that forwards to it, so
 * the byte-for-byte tier command in CI is unchanged.
 *
 * Checks come from the single source of truth scripts/gates.mjs (no hand-written
 * list here, to avoid drift):
 *   1. formatting (on by default): cargo fmt / eslint --fix / regenerate frontend
 *      contracts — writes fixes
 *   2. checks: run every gate registered in gates.mjs in order; a failure does not
 *      stop the run, and everything is summarized at the end
 *   3. summary: pass/fail list + a reproduction command per item + the tail of the
 *      failure log and the full log path
 *
 * On Windows the run first applies scripts/local-env.mjs: the temp directory moves
 * inside the checkout and stale `msvcrt.lib` stubs are dropped. Without it MSVC
 * (D8050), esbuild (`vite build`) and the contract exporter fail for a reason that
 * has nothing to do with the gate they break.
 *
 * Usage:
 *   pnpm check:all                # full: full tier (includes build:web / e2e / perf / cargo deny)
 *   pnpm check:all -- --quick     # quick: pr tier (CI merge gates)
 *   pnpm check:all -- --no-fix    # read-only: skip formatting writes, only check
 *   pnpm check:all -- --list      # only list the planned checks, do not run them
 *   pnpm check:all -- -h          # help
 *
 * Query the gate list itself: pnpm gates --list [--set pr|full]
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyLocalEnv, repoRoot } from './local-env.mjs';

/** Gate logs exceed the default 1 MiB spawn buffer; keep a generous ceiling. */
const MAX_LOG_BYTES = 256 * 1024 * 1024;

const SELF = fileURLToPath(import.meta.url);

function usage() {
  const lines = readFileSync(SELF, 'utf8').split('\n');
  const out = [];
  let inHeader = false;
  for (const line of lines) {
    if (!inHeader) {
      if (line.trim() === '/**') inHeader = true;
      continue;
    }
    if (line.trim() === '*/') break;
    out.push(line.replace(/^ \* ?/, ''));
  }
  console.log(out.join('\n'));
}

function parseArgs(argv) {
  const options = { full: true, fix: true, listOnly: false };
  for (const arg of argv) {
    switch (arg) {
      case '-q':
      case '--quick':
        options.full = false;
        break;
      case '--full':
        options.full = true;
        break;
      case '--no-fix':
        options.fix = false;
        break;
      case '--fix':
        options.fix = true;
        break;
      case '--list':
        options.listOnly = true;
        break;
      case '-h':
      case '--help':
        usage();
        process.exit(0);
        break;
      case '--':
        break; // pnpm run forwards the argument separator too; ignore it
      default:
        console.error(`unknown argument: ${arg}`);
        console.error();
        usage();
        process.exit(1);
    }
  }
  return options;
}

/** Colors, honoring NO_COLOR and a non-TTY stream. */
function palette() {
  if (!process.stdout.isTTY || process.env.NO_COLOR) {
    return { red: '', green: '', yellow: '', blue: '', dim: '', bold: '', reset: '' };
  }
  return {
    red: '\u001b[31m',
    green: '\u001b[32m',
    yellow: '\u001b[33m',
    blue: '\u001b[34m',
    dim: '\u001b[2m',
    bold: '\u001b[1m',
    reset: '\u001b[0m',
  };
}

const C = palette();

function slugify(text) {
  return text.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Run one command, capturing every byte of its output. */
function runCommand(argv, { cwd, env }) {
  const options = { cwd, env, encoding: 'buffer', maxBuffer: MAX_LOG_BYTES };
  // Windows resolves pnpm/cargo through .cmd shims, and Node requires a shell for those.
  if (process.platform === 'win32') {
    return spawnSync(argv.join(' '), { ...options, shell: true });
  }
  return spawnSync(argv[0], argv.slice(1), options);
}

function captured(result) {
  return Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]);
}

/**
 * The plan entries: the optional formatting phase, then the tier from the registry.
 *
 * The registry is the single source of truth; `--plan` is the same interface
 * check-all.sh used, so the two drivers cannot disagree about what a tier runs.
 */
function buildPlan({ full, fix }) {
  const plan = [];
  if (fix) {
    plan.push({
      group: 'Formatting',
      label: 'cargo fmt (write)',
      dir: 'src-tauri',
      argv: ['cargo', 'fmt'],
    });
    plan.push({
      group: 'Formatting',
      label: 'eslint --fix (write)',
      dir: 'root',
      argv: ['pnpm', 'lint:fix'],
    });
    plan.push({
      group: 'Formatting',
      label: 'generate frontend contracts (write)',
      dir: 'root',
      argv: ['pnpm', 'generate:contracts'],
      guarded: true,
    });
  }

  const result = spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts', 'gates.mjs'), '--plan', '--set', full ? 'full' : 'pr'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(`gates.mjs --plan failed (exit ${result.status ?? 'signal'}):`);
    console.error(result.stdout ?? '');
    console.error(result.stderr ?? '');
    process.exit(1);
  }
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [group, label, dir, ...command] = line.split('|');
    plan.push({
      group,
      label,
      dir: dir === 'tauri' ? 'src-tauri' : 'root',
      argv: command.join('|').split(/\s+/),
    });
  }
  return plan;
}

/**
 * Regenerate the frontend contracts without risking the committed directory.
 *
 * `generate-contracts.mjs` removes its output directory before compiling, so a
 * Rust compile failure would otherwise wipe `src/types/generated`. Export into a
 * scratch directory and replace the workspace files only on success.
 */
function guardedGenerateContracts(logPath) {
  const committed = join(repoRoot, 'src', 'types', 'generated');
  const scratch = mkdtempSync(join(logDir, 'contracts-'));
  const result = runCommand(['pnpm', 'generate:contracts'], {
    cwd: repoRoot,
    env: { ...process.env, LISSIO_CONTRACTS_OUT: scratch },
  });
  const log = captured(result);
  const status = result.status ?? 1;
  if (status === 0) {
    rmSync(committed, { recursive: true, force: true });
    mkdirSync(committed, { recursive: true });
    cpSync(scratch, committed, { recursive: true });
    writeFileSync(logPath, log);
  } else {
    writeFileSync(
      logPath,
      Buffer.concat([
        log,
        Buffer.from('generate:contracts failed: src/types/generated left unchanged (not replaced)\n'),
      ]),
    );
  }
  rmSync(scratch, { recursive: true, force: true });
  return status;
}

const options = parseArgs(process.argv.slice(2));
const localEnv = applyLocalEnv({ quiet: true });

const logDir = join(repoRoot, 'output', 'check-all');
rmSync(logDir, { recursive: true, force: true });
mkdirSync(logDir, { recursive: true });

const plan = buildPlan(options);

if (options.listOnly) {
  console.log(
    `check:all plan (mode: ${options.full ? 'full' : 'quick'}, ` +
      `${options.fix ? 'with formatting' : 'read-only'}):`,
  );
  for (const entry of plan) {
    console.log(
      `  ${C.blue}[${entry.group.padEnd(8)}]${C.reset} ${entry.label.padEnd(32)} ` +
        `(${entry.dir})  $ ${entry.argv.join(' ')}`,
    );
  }
  process.exit(0);
}

const mode = options.full ? 'full' : 'quick';
console.log(`${C.bold}=== check:all ===${C.reset}`);
console.log(`mode: ${mode}   formatting: ${options.fix ? 'on' : 'off'}   log directory: ${logDir}`);
if (localEnv.applied) {
  console.log(`local env: TMP/TEMP/TMPDIR → ${localEnv.tmpDir}`);
}
console.log('');

const results = [];
for (const entry of plan) {
  const index = results.length;
  const logPath = join(logDir, `${String(index).padStart(2, '0')}-${slugify(entry.label)}.log`);
  process.stdout.write(`${C.dim}▶ [${entry.group}] ${entry.label}${C.reset}\n`);
  const started = Date.now();
  const status = entry.guarded
    ? guardedGenerateContracts(logPath)
    : (() => {
        const result = runCommand(entry.argv, {
          cwd: entry.dir === 'src-tauri' ? join(repoRoot, 'src-tauri') : repoRoot,
          env: process.env,
        });
        writeFileSync(logPath, captured(result));
        return result.status ?? 1;
      })();
  const seconds = Math.round((Date.now() - started) / 1000);
  results.push({ ...entry, logPath, status, seconds });
  if (status === 0) {
    process.stdout.write(`  ${C.green}✓ passed${C.reset} (${seconds}s)\n`);
  } else {
    process.stdout.write(
      `  ${C.red}✗ failed${C.reset} (exit ${status}, ${seconds}s) → ${logPath}\n`,
    );
  }
}

// ── Formatting-change notice ─────────────────────────────────────
if (options.fix) {
  const status = spawnSync('git', ['status', '--short', '--', 'src', 'src-tauri'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const changed = (status.stdout ?? '').split('\n').filter((line) => line.trim() !== '');
  if (changed.length > 0) {
    console.log('');
    console.log(`${C.yellow}the formatting phase changed ${changed.length} files (including generated output):${C.reset}`);
    for (const line of changed.slice(0, 40)) console.log(`  ${line}`);
  }
}

// ── Summary ──────────────────────────────────────────────────────
const passed = results.filter((entry) => entry.status === 0);
const failed = results.filter((entry) => entry.status !== 0);
const totalSeconds = results.reduce((sum, entry) => sum + entry.seconds, 0);

console.log('');
console.log(`${C.bold}================ check:all summary ================${C.reset}`);
console.log(
  `mode: ${C.blue}${mode}${C.reset}   passed: ${C.green}${passed.length}${C.reset}   ` +
    `failed: ${C.red}${failed.length}${C.reset}   total time: ${totalSeconds}s`,
);
console.log('------------------------------------------------');
for (const entry of results) {
  if (entry.status === 0) {
    console.log(`  ${C.green}✓${C.reset} [${entry.group}] ${entry.label} (${entry.seconds}s)`);
  } else {
    console.log(
      `  ${C.red}✗${C.reset} [${entry.group}] ${entry.label} ` +
        `(exit ${entry.status}, ${entry.seconds}s)`,
    );
  }
}

// ── Failure details ──────────────────────────────────────────────
if (failed.length > 0) {
  console.log('');
  console.log(`${C.bold}---------------- failure details (last 40 lines of each) ----------------${C.reset}`);
  for (const entry of failed) {
    console.log('');
    console.log(`${C.red}✗ [${entry.group}] ${entry.label}${C.reset}  (exit ${entry.status})`);
    console.log(
      `  reproduce: (cd ${entry.dir === 'tauri' ? 'src-tauri' : '.'} && ${entry.argv.join(' ')})`,
    );
    console.log(`  log: ${entry.logPath}`);
    console.log(`  ${C.dim}----------------------------------------${C.reset}`);
    const tail = readFileSync(entry.logPath, 'utf8').split('\n').slice(-40);
    for (const line of tail) console.log(`  ${line}`);
  }

  const hints = [];
  for (const entry of failed) {
    if (/Playwright E2E/.test(entry.label)) {
      hints.push('E2E needs a browser: pnpm exec playwright install --with-deps chromium');
    }
    if (/cargo deny/.test(entry.label)) {
      hints.push('cargo deny is not installed: cargo install cargo-deny --version 0.20.2');
    }
    if (process.platform === 'win32' && /render budget/.test(entry.label)) {
      hints.push('the render-budget gate runs scripts/perf-gate.sh, which needs bash (Git Bash) on Windows');
    }
  }
  if (hints.length > 0) {
    console.log('');
    console.log(`${C.yellow}environment hints:${C.reset}`);
    for (const hint of hints) console.log(`  - ${hint}`);
  }
}

console.log('');
if (failed.length > 0) {
  console.log(
    `${C.red}${C.bold}check:all failed: ${failed.length} items did not pass${C.reset}  (log: ${logDir})`,
  );
  process.exit(1);
}
console.log(`${C.green}${C.bold}check:all passed (${passed.length} items)${C.reset}  (log: ${logDir})`);
