#!/usr/bin/env node
/**
 * gates.mjs — quality gates: the single source of truth.
 *
 * Why this file exists: the gate list used to be written out four times, and it
 * drifted. `build.yml` had `check:layers`; `AGENTS.md`, `CONTRIBUTING.md`, and
 * `PULL_REQUEST_TEMPLATE.md` did not. A 500-line file limit lived only inside a
 * job that cannot run (the remote is Codeberg, not GitHub), so a 514-line file
 * sat in the tree unnoticed.
 *
 * The list is now defined once, here:
 *   - `scripts/check-all.sh`      reads its execution plan from this file
 *   - `scripts/check-crate-size.mjs` reads the size rule parameters
 *   - `scripts/check-ci-gates.mjs` verifies docs and workflows against this file
 *   - `.forgejo/workflows/*.yml`  are checked gate by gate by the above
 *
 * Usage:
 *   node scripts/gates.mjs --list [--set pr|full]   human-readable inventory
 *   node scripts/gates.mjs --plan [--set pr|full]   "group|label|dir|command" for shell
 *   node scripts/gates.mjs --json                   machine-readable inventory
 *   node scripts/gates.mjs --markdown <doc>         generated doc block for that doc
 *
 * Conventions:
 *   - `id` is stable and unique; docs are verified against it.
 *   - `cmd` is an argv array, never a shell string, so nothing needs re-quoting.
 *   - `cwd` is a key of `CWD`.
 *   - `tier` decides where a gate runs: "pr" runs on every change, "full" only
 *     in the complete/release flow.
 *   - `label` and `group` are Chinese because they are console UX for
 *     `check-all.sh`. `why` is English because it is embedded into the
 *     authoritative English documents (AGENTS.md, CONTRIBUTING.md, the PR
 *     template). Keep that split.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Working-directory aliases, relative to the repository root. */
export const CWD = {
  root: '.',
  'src-tauri': 'src-tauri',
};

/**
 * The gate inventory.
 *
 * id     stable identifier, referenced by docs and the drift check
 * label  human-readable name, used for check-all.sh log filenames
 * group  grouping title in the check-all.sh summary
 * cwd    key of CWD
 * cmd    argv array, executed without a shell
 * tier   "pr" = every change; "full" = complete flow / before release
 * why    what this gate blocks (English: it is embedded into English docs)
 * docs   documents that must carry this gate's generated block
 *
 * informational: true marks a command that produces useful output but has no
 * failure mode, so it cannot block anything. It still runs — it is genuinely
 * useful and the docs reference it — but it is not counted as a gate, because
 * a number that includes checks which can never fail is a misleading number.
 */
export const GATES = [
  // ── Architecture and contracts ─────────────────────────────
  {
    id: 'architecture-inventory',
    label: 'crate 架构清单',
    group: '架构',
    cwd: 'root',
    cmd: ['pnpm', 'architecture'],
    tier: 'pr',
    // `scripts/architecture.mjs` has no exit-code path: it prints the crate
    // inventory and always succeeds. `check:architecture` is the gate that
    // actually enforces the rules this inventory describes.
    informational: true,
    why: 'crate/domain/layer/responsibility/dependency inventory for finding the type owner; prints a report and never fails, so it is informational — `check:architecture` is the gate that enforces these rules',
    docs: ['AGENTS.md'],
  },
  {
    id: 'check-architecture',
    label: '架构门禁 (领域/层级/适配器)',
    group: '架构',
    cwd: 'root',
    cmd: ['pnpm', 'check:architecture'],
    tier: 'pr',
    why: 'layout, `[package.metadata.lissio]` metadata, domain DAG, layer, adapter, and testkit rules',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'check-deps',
    label: '第三方依赖版本统一',
    group: '架构',
    cwd: 'root',
    cmd: ['pnpm', 'check:deps'],
    tier: 'pr',
    why: 'centralized third-party dependency versions inherited from the root workspace',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'check-web-contract',
    label: '命令出口契约',
    group: '架构',
    cwd: 'root',
    cmd: ['pnpm', 'check:web-contract'],
    tier: 'pr',
    why: 'command surface (`rpc-api` SUPPORTED table versus actual dispatch) stays consistent',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'check-contracts',
    label: 'Rust↔TS 合同一致',
    group: '架构',
    cwd: 'root',
    cmd: ['pnpm', 'check:contracts'],
    tier: 'pr',
    why: 'generated TypeScript matches the Rust wire types byte for byte',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'check-model-catalog',
    label: '模型目录',
    group: '架构',
    cwd: 'root',
    cmd: ['pnpm', 'check:model-catalog'],
    tier: 'pr',
    why: 'catalog fixtures, contract version, and widget kind coverage',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'check-tokens',
    label: 'UI 颜色令牌',
    group: '架构',
    cwd: 'root',
    cmd: ['pnpm', 'check:tokens'],
    tier: 'pr',
    why: 'color/opacity token unification plus the frosted-glass structural budget; see `docs/architecture/ui-color-tokens.md`',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'check-motion',
    label: '动效属性 (只走绘制层)',
    group: '架构',
    cwd: 'root',
    cmd: ['pnpm', 'check:motion'],
    tier: 'pr',
    why: 'every `transition`/`@keyframes` property stays on the paint layer; layout animations run in C++ and are invisible to the browser probe, so only a static check can catch them',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'check-layers',
    label: '前端分层 (实现/交互/效果/视图)',
    group: '架构',
    cwd: 'root',
    cmd: ['pnpm', 'check:layers'],
    tier: 'pr',
    why: 'frontend implementation/interaction/effects/view layers must not cross their boundaries',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'check-docs',
    label: '文档与许可证',
    group: '架构',
    cwd: 'root',
    cmd: ['pnpm', 'check:docs'],
    tier: 'pr',
    why: 'LICENSE/NOTICE integrity, license fields across the workspace, documentation index and links, review-record metadata; see `docs/governance/`',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'check-ci-gates',
    label: 'CI 门禁防漂移',
    group: '架构',
    cwd: 'root',
    cmd: ['pnpm', 'check:ci-gates'],
    tier: 'pr',
    why: 'documentation and `.forgejo` workflows match this file; keeps the gate list from being re-written by hand',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },

  // ── Frontend ───────────────────────────────────────────────
  {
    id: 'typecheck',
    label: 'TypeScript 类型',
    group: '前端',
    cwd: 'root',
    cmd: ['pnpm', 'typecheck'],
    tier: 'pr',
    why: 'TypeScript compiles under strict mode',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'lint-ci',
    label: 'ESLint (零警告)',
    group: '前端',
    cwd: 'root',
    cmd: ['pnpm', 'lint:ci'],
    tier: 'pr',
    why: 'lint with zero warnings tolerated',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'test-frontend',
    label: 'Vitest 单测',
    group: '前端',
    cwd: 'root',
    cmd: ['pnpm', 'test'],
    tier: 'pr',
    why: 'frontend unit tests, colocated with the code they cover',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },

  // ── Rust ───────────────────────────────────────────────────
  {
    id: 'rust-source-size',
    label: 'Rust 生产文件 500 行上限',
    group: 'Rust',
    cwd: 'root',
    cmd: ['pnpm', 'check:rust-size'],
    tier: 'pr',
    why: 'production Rust files stay within 500 lines; test files and benches are exempt',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'cargo-fmt',
    label: 'cargo fmt --check',
    group: 'Rust',
    cwd: 'src-tauri',
    cmd: ['cargo', 'fmt', '--check'],
    tier: 'pr',
    why: 'formatting has no diff',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'cargo-clippy',
    label: 'cargo clippy --all-targets',
    group: 'Rust',
    cwd: 'src-tauri',
    cmd: ['cargo', 'clippy', '--workspace', '--all-targets'],
    tier: 'pr',
    why: 'workspace lints deny all/pedantic/nursery/cargo',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'cargo-test',
    label: 'cargo test --workspace',
    group: 'Rust',
    cwd: 'src-tauri',
    cmd: ['cargo', 'test', '--workspace'],
    tier: 'pr',
    why: 'every workspace test target, including test-target compilation',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },

  // ── Release: version + changelog stay in step ──────────────
  {
    id: 'check-changes',
    label: '变更文件合法性',
    group: '发布',
    cwd: 'root',
    cmd: ['pnpm', 'check:changes'],
    tier: 'pr',
    why: 'every change file declares a known package, a valid bump, and a declared tag, so covector cannot drop a release note silently; see `.changes/README.md`',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'check-release-sync',
    label: '发布同步 (版本 ↔ CHANGELOG)',
    group: '发布',
    cwd: 'root',
    cmd: ['pnpm', 'check:release-sync'],
    tier: 'pr',
    why: '`package.json`, `tauri.conf.json`, `Cargo.toml`, and `Cargo.lock` agree on one version, and `CHANGELOG.md` plus its Chinese backup carry that version; see `RELEASING.md`',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },

  // ── Slow items: complete flow only ─────────────────────────
  {
    id: 'build-web',
    label: 'Web 生产构建',
    group: '前端·慢',
    cwd: 'root',
    cmd: ['pnpm', 'build:web'],
    tier: 'full',
    why: 'production frontend build; catches bundling errors that type checking cannot see',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'e2e',
    label: 'Playwright E2E',
    group: '前端·慢',
    cwd: 'root',
    cmd: ['pnpm', 'test:e2e'],
    tier: 'full',
    why: 'browser smoke tests; install with `pnpm exec playwright install --with-deps chromium`',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'perf-check',
    label: '前端渲染预算',
    group: '前端·慢',
    cwd: 'root',
    cmd: ['bash', 'scripts/perf-gate.sh'],
    // Alternate invocations that mean the same gate; the drift check accepts any
    // of them in a workflow or a document.
    aliases: [['pnpm', 'perf:check']],
    tier: 'full',
    why: 'measures per-frame cost in a real browser, then compares against the committed baseline; counts per frame, never wall-clock fps. `pnpm perf:baseline` overwrites the baseline and is only for an intended change; see `docs/performance/frontend-render-budget.md`',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
  {
    id: 'cargo-deny',
    label: 'cargo deny',
    group: 'Rust·慢',
    cwd: 'src-tauri',
    cmd: ['cargo', 'deny', 'check'],
    tier: 'full',
    why: 'advisories, licenses, bans, and sources; requires cargo-deny 0.20.2',
    docs: ['AGENTS.md', 'CONTRIBUTING.md', 'PULL_REQUEST_TEMPLATE.md'],
  },
];

/** Filter by tier. `full` includes `pr`. */
export function gatesFor(tier) {
  return tier === 'full' ? GATES : GATES.filter((gate) => gate.tier === 'pr');
}

/**
 * The one command that runs a whole tier. `.forgejo/workflows/*.yml` must invoke
 * exactly these and must never name an individual gate.
 *
 * This is the load-bearing decision of the CI design. A workflow that lists
 * gates as steps can be silently defanged — comment a step out, replace its
 * command with `echo`, wrap it in `if false`, append `|| true` — and it still
 * *looks* like the gate is there. No checker can reliably tell by reading shell
 * text: an independent audit defeated twelve such checkers. A workflow that runs
 * one script and names no gate has nothing to defang, and "does it invoke the
 * tier command verbatim?" is a question with an exact answer.
 *
 * The `run:` body must match the joined text byte for byte, so appending
 * anything to it is a drift failure rather than a silent bypass.
 */
export const TIER_COMMANDS = {
  pr: ['bash', 'scripts/check-all.sh', '--quick', '--no-fix'],
  full: ['bash', 'scripts/check-all.sh', '--no-fix'],
};

/** How a tier command must appear verbatim in a workflow `run:` body. */
export function tierCommandText(tier) {
  return TIER_COMMANDS[tier].join(' ');
}

/** `pnpm` script names that may appear in a workflow without being a gate. */
export const NON_GATE_SCRIPTS = [
  'install',
  'exec',
  'dev:web',
  'dev:server',
  'dev:desktop',
  'build:server',
  'build:cli',
  'build:desktop',
  'generate:contracts',
  'set-version',
  'publish:release',
  'release:verify',
];

/**
 * The runner label, read from the registration command in docs/ci.md so the
 * document is the one place it is written down. A job pinned to a label no
 * runner carries is never scheduled, and a never-scheduled job looks exactly
 * like a passing one.
 */
export function documentedRunnerLabel(docText) {
  const match = docText.match(/--labels\s+([A-Za-z0-9_.-]+):/);
  return match ? match[1] : null;
}

/** Validate the registry itself (unique ids, known cwd, required fields). */
export function validateRegistry() {
  const problems = [];
  const seen = new Set();
  const required = ['id', 'label', 'group', 'cwd', 'cmd', 'tier', 'why', 'docs'];
  for (const gate of GATES) {
    for (const key of required) {
      if (gate[key] === undefined) problems.push(`${gate.id ?? '<no id>'}: missing field ${key}`);
    }
    if (seen.has(gate.id)) problems.push(`duplicate gate id: ${gate.id}`);
    seen.add(gate.id);
    if (gate.cwd && !(gate.cwd in CWD)) problems.push(`${gate.id}: unknown cwd "${gate.cwd}"`);
    if (!Array.isArray(gate.cmd) || gate.cmd.length === 0) {
      problems.push(`${gate.id}: cmd must be a non-empty array`);
    } else if (gate.cmd.some((part) => typeof part !== 'string' || part.includes(' '))) {
      problems.push(`${gate.id}: every cmd part must be one argument with no spaces`);
    }
    if (gate.tier && !['pr', 'full'].includes(gate.tier)) {
      problems.push(`${gate.id}: unknown tier "${gate.tier}"`);
    }
  }
  return problems;
}

/** Gates that must appear in a given document. */
export function gatesForDoc(docPath) {
  return GATES.filter((gate) => gate.docs.includes(docPath));
}

/** Markers around generated content; text between them is generated, never hand-written. */
export const BLOCK_START = '<!-- lissio-gates:start -->';
export const BLOCK_END = '<!-- lissio-gates:end -->';

/**
 * Per-document rendering style.
 *
 *   list      — `- \`command\` — why`      (reference sections)
 *   checklist — `- [ ] \`command\` — why`  (the PR verification checklist)
 *   inline    — `- [ ] \`a\`, \`b\`, \`c\`` (compact grouped checklist)
 */
export const DOC_STYLES = {
  'AGENTS.md': 'list',
  'CONTRIBUTING.md': 'list',
  'PULL_REQUEST_TEMPLATE.md': 'checklist',
};

/**
 * Document identifier → repository-relative path. Identifiers keep the `docs`
 * arrays in `GATES` short and readable; the paths are what actually gets read.
 */
export const DOC_PATHS = {
  'AGENTS.md': 'AGENTS.md',
  'CONTRIBUTING.md': 'CONTRIBUTING.md',
  'PULL_REQUEST_TEMPLATE.md': '.github/PULL_REQUEST_TEMPLATE.md',
};

/** Chinese console group → English heading used inside generated doc blocks. */
const GROUP_HEADINGS = {
  架构: 'Architecture and contracts',
  发布: 'Release',
  前端: 'Frontend',
  Rust: 'Rust',
  '前端·慢': 'Frontend (slow: complete flow only)',
  'Rust·慢': 'Rust (slow: complete flow only)',
};

/** Render one gate's command as it should appear in prose. */
function commandText(gate) {
  return gate.cwd === 'root' ? gate.cmd.join(' ') : `(cd ${CWD[gate.cwd]} && ${gate.cmd.join(' ')})`;
}

/** Render the generated block body for a document (markers excluded). */
export function renderDocBlock(docPath) {
  const style = DOC_STYLES[docPath] ?? 'list';
  const gates = gatesForDoc(docPath);
  const lines = [];
  const seenGroups = new Set();
  for (const gate of gates) {
    if (!seenGroups.has(gate.group)) {
      if (seenGroups.size > 0) lines.push('');
      // English heading: this text lands in authoritative English documents.
      // `gate.group` stays Chinese because it is check-all.sh console UX.
      lines.push(`**${GROUP_HEADINGS[gate.group] ?? gate.group}**`);
      lines.push('');
      seenGroups.add(gate.group);
    }
    const bullet = style === 'checklist' ? '- [ ] ' : '- ';
    lines.push(`${bullet}\`${commandText(gate)}\` — ${gate.why}`);
  }
  return lines.join('\n');
}

/** Replace the content between the markers, returning the new text (or null if unmarked). */
export function spliceDocBlock(text, docPath) {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) return null;
  const before = text.slice(0, start + BLOCK_START.length);
  const after = text.slice(end);
  return `${before}\n\n${renderDocBlock(docPath)}\n\n${after}`;
}

/** Extract the current generated block body (markers excluded), or null if unmarked. */
export function extractDocBlock(text) {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) return null;
  return text
    .slice(start + BLOCK_START.length, end)
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ gates: GATES, cwd: CWD, docStyles: DOC_STYLES }, null, 2));
    return;
  }

  let tier = 'full';
  const setIndex = argv.indexOf('--set');
  if (setIndex !== -1) tier = argv[setIndex + 1] ?? 'pr';

  const problems = validateRegistry();
  if (problems.length > 0) {
    console.error('gate registry is inconsistent:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  // `--markdown <doc>` prints the generated block for that document
  const mdIndex = argv.indexOf('--markdown');
  if (mdIndex !== -1) {
    const doc = argv[mdIndex + 1];
    if (!doc) {
      console.error('--markdown needs a document path, for example --markdown AGENTS.md');
      process.exit(1);
    }
    console.log(renderDocBlock(doc));
    return;
  }

  // `--plan` feeds check-all.sh: "group|label|dir|command"
  if (argv.includes('--plan')) {
    const dirAlias = { root: 'root', 'src-tauri': 'tauri' };
    for (const gate of gatesFor(tier === 'pr' ? 'pr' : 'full')) {
      console.log([gate.group, gate.label, dirAlias[gate.cwd], gate.cmd.join(' ')].join('|'));
    }
    return;
  }

  const gates = gatesFor(tier === 'pr' ? 'pr' : 'full');
  const enforcing = gates.filter((gate) => !gate.informational).length;
  const informational = gates.length - enforcing;
  console.log(
    `gates (${tier === 'pr' ? 'PR fast' : 'complete'}, ${enforcing} enforcing` +
      `${informational > 0 ? `, ${informational} informational` : ''}):`,
  );
  for (const gate of gates) {
    const tag = gate.informational ? ' (informational: never fails)' : '';
    console.log(`  [${gate.group}] ${gate.label}  (${gate.tier})${tag}`);
    console.log(`      $ (cd ${gate.cwd === 'root' ? 'root' : gate.cwd} && ${gate.cmd.join(' ')})`);
    console.log(`      ${gate.why}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
