#!/usr/bin/env node
/**
 * check-ci-gates.mjs — keeps CI gates from drifting apart again.
 *
 * The original problem: the gate list was written out by hand in four places,
 * and they disagreed. `build.yml` ran `check:layers`; `AGENTS.md`,
 * `CONTRIBUTING.md`, and `PULL_REQUEST_TEMPLATE.md` did not. A 500-line file
 * limit existed only inside a `lint.yml` job that cannot run (the repository
 * remote is Codeberg), so a 514-line file sat in the tree unnoticed for weeks.
 *
 * This script treats `scripts/gates.mjs` as the single source of truth and
 * verifies, byte for byte, that:
 *
 *   1. the registry is internally consistent;
 *   2. every gate's pnpm script really exists in package.json;
 *   3. each document's generated block (`<!-- lissio-gates:start -->`) matches
 *      exactly what `gates.mjs` would render — so a document cannot silently
 *      disagree with the registry;
 *   4. `.forgejo/workflows/*.yml` invoke the tier commands verbatim and name no
 *      individual gate.
 *
 * Point 4 is deliberately the *inverse* of "check that every gate appears in the
 * workflows". An earlier version asked that question and answered it by
 * searching the workflow text for each gate's command. That is unsound: the
 * command can be present and inert. An audit defeated it twelve ways — a
 * commented-out `# pnpm check:tokens`, `echo "would run: ..."`, `if false; then
 * ... fi`, an `exit 0` above the line, a here-doc, a trailing `|| true`,
 * job-level `if: false`, a `needs:` chain through a guarded job, a bogus
 * `runs-on` label, and a second workflow with no `pull_request` trigger. Every
 * one leaves the text intact while the gate does not run.
 *
 * The workflows therefore do not list gates at all; each job runs one tier
 * command. "Does this workflow name a gate it should not?" is answerable
 * exactly, and there is no per-gate step left to disable.
 *
 * Run `node scripts/gates.mjs --markdown <doc>` to see the correct block, or
 * `pnpm check:ci-gates --fix` to rewrite the blocks in place.
 *
 * Usage: pnpm check:ci-gates [--fix]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import {
  BLOCK_END,
  BLOCK_START,
  DOC_PATHS,
  DOC_STYLES,
  EXTERNAL_RUST_WORKSPACES,
  GATES,
  NON_GATE_SCRIPTS,
  documentedRunnerLabel,
  extractDocBlock,
  gatesFor,
  renderDocBlock,
  repoRoot,
  spliceDocBlock,
  TIER_DRIVERS,
  tierCommandText,
  validateRegistry,
} from './gates.mjs';

const argv = process.argv.slice(2);
const FIX = argv.includes('--fix');

const errors = [];
const fail = (message) => errors.push(message);
const read = (path) => readFileSync(path, 'utf8');

/** Line endings are never part of what a gate verifies: a CRLF checkout is equal. */
const normalizeEol = (text) => text.replace(/\r\n/g, '\n');

// ── 1. Registry self-consistency ──────────────────────────────
for (const problem of validateRegistry()) fail(`gates.mjs: ${problem}`);

// ── 2. Every referenced pnpm script exists, and no check script is orphaned ──
const pkg = JSON.parse(read(join(repoRoot, 'package.json')));
const scripts = pkg.scripts ?? {};

/**
 * A gate's disappearance from the registry must not pass silently.
 *
 * Everything above verifies the registry *internally*, so a gate deleted from
 * `scripts/gates.mjs` simply stops existing as far as those checks are
 * concerned — and since the workflows now run tiers rather than named gates, no
 * workflow would notice either. The whole point of the registry is that a gate
 * cannot quietly stop running, so registry *shrinkage* needs its own anchor.
 *
 * The anchor is `package.json`: every check the repository can run is a script
 * there. A `check:*` / `lint*` / `test*` / `typecheck` / `architecture` script
 * that the registry does not account for is either a gate that was dropped or a
 * new gate that was never registered. Both should fail loudly.
 *
 * Deliberately *not* anchored on gate counts or on git history: a count would
 * fail whenever a gate is legitimately split, and history is not available in a
 * fresh clone or an archive.
 */
const CHECK_SHAPED = /^(check:|lint$|lint:|test$|test:|typecheck$|architecture$)/;
/**
 * Local-only scripts that are deliberately not gates, with the reason.
 *
 * Only names that are *not* `check:`-prefixed may appear here. A `check:*`
 * script is a gate by construction and gets no escape hatch, because an
 * allowlist entry is exactly how a deleted gate gets silenced rather than
 * noticed. The tier drivers (`check:all`, `check:all:quick`) are exempt for a
 * structural reason instead: they invoke the tier script.
 */
const LOCAL_ONLY_SCRIPTS = new Map([
  ['lint', 'plain `eslint .` without `--max-warnings 0`; the zero-warning `lint:ci` is the gate'],
  ['lint:fix', 'writes the tree; the read-only `lint:ci` form is the gate'],
  ['test:watch', 'interactive watcher; `test` is the gate'],
  ['test:perf', 'runs Playwright against a perf server; `perf:check` is the gate'],
]);

/** The pnpm script a gate invokes, or null when it does not go through pnpm. */
function pnpmScriptOf(gate) {
  return gate.cmd[0] === 'pnpm' ? gate.cmd[1] : null;
}

/** Every pnpm script name that legitimately identifies this gate. */
function pnpmScriptsOf(gate) {
  const names = [];
  const primary = pnpmScriptOf(gate);
  if (primary) names.push(primary);
  for (const alias of gate.aliases ?? []) {
    if (alias[0] === 'pnpm') names.push(alias[1]);
  }
  return names;
}

for (const gate of GATES) {
  for (const script of pnpmScriptsOf(gate)) {
    if (!(script in scripts)) {
      fail(`gates.mjs: gate ${gate.id} runs "pnpm ${script}" but package.json has no such script`);
    }
  }
  // A gate that shells out to a file should point at a file that exists.
  for (const part of gate.cmd) {
    if (part.endsWith('.mjs') || part.endsWith('.sh')) {
      const file = join(repoRoot, gate.cwd === 'root' ? '.' : gate.cwd, part);
      const direct = join(repoRoot, part);
      if (!existsSync(file) && !existsSync(direct)) {
        fail(`gates.mjs: gate ${gate.id} references missing file ${part}`);
      }
    }
  }
}

// Every check-shaped package.json script must be accounted for by a gate.
// This is one of the anchors that makes registry shrinkage fail, not pass.
{
  const registered = new Set();
  for (const gate of GATES) {
    registered.add(gate.cmd.join(' '));
    for (const name of pnpmScriptsOf(gate)) registered.add(name);
    for (const alias of gate.aliases ?? []) registered.add(alias.join(' '));
  }
  // Gates that shell out to a script also cover that script's direct invocation.
  const registeredFiles = new Set();
  for (const gate of GATES) {
    for (const part of gate.cmd) {
      if (part.endsWith('.mjs') || part.endsWith('.sh')) registeredFiles.add(part);
    }
  }

  // Tier drivers: the shell entry point CI runs verbatim and the Node driver it
  // forwards to. A `check:*` script that invokes either is the tier driver, not a
  // gate.

  for (const [name, command] of Object.entries(scripts)) {
    if (!CHECK_SHAPED.test(name)) continue;
    if (registered.has(name)) continue;
    // A script whose body is a registered gate script is covered through it.
    if ([...registeredFiles].some((file) => command.includes(file))) continue;

    // A `check:*` script is a gate by construction, so it gets no allowlist
    // escape. Only the tier drivers are exempt, and they are recognisable
    // because they invoke the tier script. Without this, a gate could be
    // deleted from the registry and silenced with a single well-reasoned-looking
    // line added to LOCAL_ONLY_SCRIPTS — which the failure text used to invite.
    if (name.startsWith('check:')) {
      if (TIER_DRIVERS.some((driver) => command.includes(driver))) continue;
      fail(
        `package.json: script "${name}" is a check but no gate in scripts/gates.mjs runs it. A ` +
          '`check:*` script is a gate: register it in the registry, or delete the script. There is ' +
          'deliberately no allowlist for these, because an allowlist is how a deleted gate gets ' +
          'silenced instead of noticed',
      );
      continue;
    }

    // Weaker local variants of a gate (a writable `lint`, an interactive
    // `test:watch`) may be declared, with the reason they are not gates.
    if (LOCAL_ONLY_SCRIPTS.has(name)) continue;
    fail(
      `package.json: script "${name}" looks like a gate but no gate in scripts/gates.mjs runs it — ` +
        `register it, remove it, or declare it in this file with the reason it is not a gate`,
    );
  }
}

// Registry shrinkage and informational abuse.
//
// The package.json anchor above covers the pnpm gates, but the cargo gates
// (`cargo fmt --check`, `cargo clippy`, `cargo test`, `cargo deny`) have no
// package.json script, so deleting one leaves no trace there. The documentation
// blocks are generated *from* the registry, so `--fix` erases that evidence too
// — verified: deleting the `cargo-test` gate and running `--fix` reported fully
// green before these anchors existed.
//
// The anchor is the repository's own structure. If `server/Cargo.toml` is
// present then this is a Rust workspace, and a Rust workspace must have
// formatting, lint, and test gates. That is a statement about required
// capabilities, not a second copy of the gate list, so it does not reintroduce
// the drift it is meant to prevent: it does not care which gate ids fulfil it.
const CAPABILITY_ANCHORS = [
  {
    // A Rust workspace has these files at its root.
    present: ['server/Cargo.toml'],
    require: [
      { match: (gate) => gate.cmd[0] === 'cargo' && gate.cmd[1] === 'fmt', what: 'a `cargo fmt --check` gate', tier: 'pr' },
      { match: (gate) => gate.cmd[0] === 'cargo' && gate.cmd[1] === 'clippy', what: 'a `cargo clippy` gate', tier: 'pr' },
      { match: (gate) => gate.cmd[0] === 'cargo' && gate.cmd[1] === 'test', what: 'a `cargo test` gate', tier: 'pr' },
    ],
  },
  {
    // A deny configuration exists to be enforced, not to sit in the tree.
    present: ['server/deny.toml'],
    require: [
      { match: (gate) => gate.cmd[0] === 'cargo' && gate.cmd[1] === 'deny', what: 'a `cargo deny check` gate', tier: null },
    ],
  },
  {
    // A browser test directory exists to be run.
    present: ['playwright.config.ts'],
    require: [
      { match: (gate) => /e2e/.test(gate.cmd.join(' ')), what: 'a browser end-to-end gate', tier: null },
    ],
  },
  {
    // A production bundler config must be exercised, not merely type-checked.
    present: ['client/vite.config.ts'],
    require: [
      { match: (gate) => gate.cmd.join(' ') === 'pnpm build:web', what: 'a production web build gate', tier: null },
    ],
  },
  {
    // A committed performance baseline exists to be compared against.
    present: ['docs/performance/frontend-perf.json'],
    require: [
      { match: (gate) => /perf/.test(gate.cmd.join(' ')), what: 'a frontend render-budget gate', tier: null },
    ],
  },
  {
    // TypeScript sources require a type check.
    present: ['client/tsconfig.json'],
    require: [
      { match: (gate) => gate.cmd.join(' ') === 'pnpm typecheck', what: 'a TypeScript type-check gate', tier: 'pr' },
    ],
  },
  {
    // A frontend unit-test setup requires a unit-test gate.
    present: ['client/vitest.config.ts'],
    require: [{ match: (gate) => gate.cmd.join(' ') === 'pnpm test', what: 'a frontend unit-test gate', tier: 'pr' }],
  },
];

for (const anchor of CAPABILITY_ANCHORS) {
  if (!anchor.present.every((path) => existsSync(join(repoRoot, path)))) continue;
  for (const need of anchor.require) {
    const matches = GATES.filter(need.match);
    if (matches.length === 0) {
      fail(
        `gates.mjs: ${anchor.present.join(', ')} exists, so the registry must contain ${need.what}, ` +
          'but no gate does. A gate that disappears from the registry is invisible to every other ' +
          'check here — deleting one is how a gate silently stops running.',
      );
    } else if (need.tier && !matches.some((gate) => gate.tier === need.tier)) {
      fail(
        `gates.mjs: ${need.what} exists but is not tier "${need.tier}", so it would not run on pull requests`,
      );
    }
  }
}

// Cargo workspaces the registry's cargo gates deliberately do not run in.
//
// The cargo gates run from `server/`, which cannot see `server/core` or
// `server/data` (they declare `[workspace]` roots of their own and are excluded
// from its member list). That is deliberate — each of those repositories runs its
// own CI — but it stops being deliberate the moment one of them becomes a member
// of the server workspace, because then the umbrella's `cargo fmt`/`clippy`/`test`
// gates would skip crates that no other gate covers either. The registry states
// the exclusion; this verifies the statement still describes the tree.
for (const workspace of EXTERNAL_RUST_WORKSPACES) {
  const manifest = join(repoRoot, workspace, 'Cargo.toml');
  // Not checked out: nothing to disagree with yet.
  if (!existsSync(manifest)) continue;
  if (!/^\s*\[workspace\]\s*$/m.test(read(manifest))) {
    fail(
      `gates.mjs: EXTERNAL_RUST_WORKSPACES lists "${workspace}", but its Cargo.toml no longer declares a ` +
        '[workspace] root — the umbrella\'s cargo gates run in `server/` only, so its crates would be ' +
        'checked by nothing. Add them to the server workspace and to the registry, or keep the workspace split',
    );
  }
}

/**
 * Gate tiers are anchored: every enforcing gate runs on pull requests unless it
 * is deliberately declared complete-flow-only below.
 *
 * The rest of this file verifies that the registry, the generated documents and
 * the workflows agree with each other — but the documents are rendered *from*
 * the registry and the workflows run the tier commands, so all of them move
 * together when a gate's `tier` changes. That is exactly the gap an audit
 * reproduced: demoting `check-layers` from `pr` to `full` kept
 * `node scripts/check-ci-gates.mjs` green (exit 0), and `--fix` regenerated the
 * documents with no trace that a gate had left every pull request.
 *
 * The PR tier is the merge gate, so running there is the default for an
 * enforcing gate, not an accident. The four complete-flow gates are the
 * reviewed exceptions, and each states why it cannot run on every change.
 * Because the rule is enforced in both directions, promoting one of them is
 * also a deliberate edit: the stale declaration fails until it is removed.
 */
const FULL_ONLY_GATES = new Map([
  ['build-web', 'a production bundling run is a complete-flow cost, not a per-change one'],
  ['e2e', 'the browser suite starts a real backend and a Vite server'],
  ['perf-check', 'the render-budget probe drives a real browser and is timing-sensitive'],
  ['cargo-deny', 'the advisory/license audit needs a writable advisory cache and is slow'],
]);
for (const gate of GATES) {
  // An informational entry cannot fail, so its tier cannot weaken a merge gate.
  if (gate.informational) continue;
  const why = FULL_ONLY_GATES.get(gate.id);
  if (gate.tier === 'pr') {
    if (why !== undefined) {
      fail(
        `gates.mjs: gate ${gate.id} is declared complete-flow-only in check-ci-gates.mjs ` +
          `("${why}") but runs in the pr tier — the declaration is stale; remove it from ` +
          'FULL_ONLY_GATES, or leave the gate in "full"',
      );
    }
    continue;
  }
  if (why === undefined) {
    fail(
      `gates.mjs: gate ${gate.id} runs in the "${gate.tier}" tier but is not declared ` +
        'complete-flow-only in check-ci-gates.mjs. Pull requests are the merge gate, so an ' +
        'enforcing gate must run there unless it is listed in FULL_ONLY_GATES with the reason ' +
        'it cannot. Without this anchor a demotion changes nothing any other check looks at',
    );
  }
}

/**
 * `informational` must stay an exception, not an escape hatch.
 *
 * The flag excludes a command from the gate count, and a command that cannot
 * fail enforces nothing. Marking gates informational en masse would therefore
 * disable the registry's meaning while every check above still passed — verified
 * by marking all 21 gates informational: the checker reported green. Only
 * commands demonstrated to have no failure path may appear here.
 */
const INFORMATIONAL_ALLOWED = new Set(['architecture-inventory']);
for (const gate of GATES.filter((candidate) => candidate.informational)) {
  if (!INFORMATIONAL_ALLOWED.has(gate.id)) {
    fail(
      `gates.mjs: gate ${gate.id} is marked informational, but only ` +
        `${[...INFORMATIONAL_ALLOWED].join(', ')} may be — informational excludes a command from the ` +
        'gate count, so it requires evidence that the command has no failure path. If the command ' +
        'can fail, remove the flag; if it genuinely cannot, justify it in INFORMATIONAL_ALLOWED.',
    );
  }
}

// The published plan must actually execute the registry.
//
// `check-all.sh` does not read the `GATES` array; it runs `gates.mjs --plan` and
// executes the rows that come back. So the *plan* is what CI runs, and it had no
// check at all. Two edits left every other check green while CI printed
// "check:all passed" having run nothing:
//
//   - replacing every `cmd:` with `['true']` (the registry still has 21 gates,
//     the tiers and docs are untouched, and the plan happily emits `...|true`);
//   - making the `--plan` branch return early, so the plan is empty.
//
// The second is the more dangerous, because bash 5 expands an empty array under
// `set -u` harmlessly and `check-all.sh` would report success with a 0-item
// summary. Both are caught here.
{
  const NOOP_COMMANDS = new Set(['true', ':', 'echo', 'exit', 'sleep', 'cat', 'printf', 'sh', 'bash']);
  for (const gate of GATES) {
    const argv0 = gate.cmd[0];
    // `bash scripts/...` is fine; a bare `bash`/`sh` with no script is not.
    if (argv0 === 'bash' || argv0 === 'sh') {
      if (gate.cmd.length < 2) {
        fail(`gates.mjs: gate ${gate.id} runs "${gate.cmd.join(' ')}", which has no script to execute`);
      }
      continue;
    }
    if (NOOP_COMMANDS.has(argv0)) {
      fail(
        `gates.mjs: gate ${gate.id} runs "${gate.cmd.join(' ')}", which cannot fail — a gate that ` +
          'always succeeds enforces nothing, and replacing real commands with no-ops is one way a ' +
          'registry can be hollowed out while every other check here still passes',
      );
    }
    if (gate.cmd.length === 0) {
      fail(`gates.mjs: gate ${gate.id} has an empty command`);
    }
  }

  for (const tier of ['pr', 'full']) {
    const expected = gatesFor(tier).length;
    let rows;
    try {
      const output = execFileSync(
        process.execPath,
        [join(repoRoot, 'scripts', 'gates.mjs'), '--plan', '--set', tier],
        { encoding: 'utf8' },
      );
      rows = output.split('\n').filter((row) => row.trim() !== '');
    } catch (error) {
      fail(`scripts/gates.mjs --plan --set ${tier} could not be run: ${error.message}`);
      continue;
    }
    if (rows.length === 0) {
      fail(
        `scripts/gates.mjs --plan --set ${tier} emitted an empty plan — scripts/check-all.sh would ` +
          'run no gates at all and still print a passing summary',
      );
      continue;
    }
    if (rows.length !== expected) {
      fail(
        `scripts/gates.mjs --plan --set ${tier} emitted ${rows.length} rows but the registry has ` +
          `${expected} gates for that tier — the plan is what CI executes, so it must match`,
      );
    }
    for (const row of rows) {
      const command = row.split('|').slice(3).join('|');
      const tokens = command.trim().split(/\s+/);
      const argv0 = tokens[0];
      // `bash <script>` is a real command; a bare `bash` is not.
      if (argv0 === 'bash' || argv0 === 'sh') {
        if (tokens.length < 2) {
          fail(`scripts/gates.mjs --plan --set ${tier} emits a scriptless command: "${command}"`);
        }
        continue;
      }
      if (NOOP_COMMANDS.has(argv0)) {
        fail(`scripts/gates.mjs --plan --set ${tier} emits a no-op command: "${command}"`);
      }
    }
  }
}

// Install-time lifecycle hooks are refused.
//
// They run during the workflow's own `pnpm install --frozen-lockfile` step, which
// happens *before* any gate runs and before `check:ci-gates` can object. A hook
// that rewrites `scripts/gates.mjs` therefore makes every subsequent gate a
// no-op while the workflow file itself stays byte-identical to the reviewed
// version — demonstrated, with the `ci.yml` hash unchanged on both sides.
//
// Nothing here needs an install hook: dependencies are plain npm packages and
// there are no patched dependencies or native rebuild steps. If one is ever
// genuinely required it belongs in an explicit `run:` step, where it is visible,
// not in an install hook that executes on every checkout.
{
  const HOOKS = [
    'preinstall',
    'install',
    'postinstall',
    'prepublish',
    'prepublishOnly',
    'prepare',
    'prepack',
  ];
  for (const hook of HOOKS) {
    if (scripts[hook]) {
      fail(
        `package.json: "${hook}" runs on every install, before any gate can check it. An install ` +
          'hook can rewrite the gate machinery and disarm CI while the workflow file stays ' +
          'unchanged. Move the work into an explicit workflow step instead',
      );
    }
  }
  if (pkg.patchedDependencies !== undefined) {
    fail('package.json: "patchedDependencies" patches packages at install time, which no gate can verify');
  }
}

// ── 3. Generated doc blocks must match exactly ────────────────
const documentedDocs = [...new Set(Object.keys(DOC_STYLES))];
for (const doc of documentedDocs) {
  const relPath = DOC_PATHS[doc] ?? doc;
  const path = join(repoRoot, relPath);
  const display = relPath;
  if (!existsSync(path)) {
    fail(`${display}: file does not exist but gates.mjs declares a generated block for it`);
    continue;
  }
  const text = read(path);
  const current = extractDocBlock(text);
  if (current === null) {
    fail(`${display}: missing the generated gate block; wrap it in ${BLOCK_START} / ${BLOCK_END}`);
    continue;
  }
  const expected = renderDocBlock(doc);
  // Line endings are not part of the block, so a CRLF checkout carries the same
  // content; comparing raw bytes would report drift on it.
  if (normalizeEol(current) !== expected) {
    if (FIX) {
      // Write the document back with one consistent line ending, so a Windows
      // checkout is not left with a CRLF file holding an LF block.
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      writeFileSync(path, spliceDocBlock(text, doc).replace(/\r?\n/g, eol));
      console.log(`  fixed ${display}`);
    } else {
      fail(
        `${display}: generated gate block is out of date. ` +
          `Refresh it with \`node scripts/gates.mjs --markdown ${doc}\` or run \`pnpm check:ci-gates --fix\``,
      );
    }
  }
}

// Guard against a gate that claims to be documented in a file with no block.
for (const gate of GATES) {
  for (const doc of gate.docs) {
    if (!documentedDocs.includes(doc)) {
      fail(
        `gates.mjs: gate ${gate.id} lists "${doc}" in docs, but that file has no generated block — ` +
          'add it to DOC_STYLES in scripts/gates.mjs',
      );
    }
  }
}
// ── 4. Workflows must invoke the tier commands verbatim, and name no gate ──
//
// The property is deliberately the inverse of "every gate appears in a
// workflow". That question cannot be answered soundly by reading shell text: a
// gate's command can be present yet inert (commented out, echoed, inside a dead
// branch, after an `exit 0`, inside a here-doc, or made non-blocking by `|| true`
// or `continue-on-error`). An audit defeated a text-searching checker twelve
// ways. So the workflows name no gate at all, and this section enforces exactly
// that — a property with no false negatives:
//
//   a. every workflow parses as YAML;
//   b. a workflow that provides pull-request coverage must trigger on
//      `pull_request`, and must run the `pr` tier command byte for byte;
//   c. a workflow that runs the `full` tier must run that command byte for byte;
//   d. no workflow step may name an individual gate; the tier script is the only
//      way a gate is reached, so nothing can be disabled one gate at a time;
//   e. every workflow job must use the runner label documented in docs/ci.md —
//      a job pinned to a label no runner has never runs, and would look green;
//   f. gates reached only through `needs:` are impossible by construction now,
//      because there is one gate-bearing step per tier and no gate names.
const workflowDir = join(repoRoot, '.forgejo', 'workflows');
const workflowFiles = existsSync(workflowDir)
  ? readdirSync(workflowDir)
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
      .sort()
  : [];
if (workflowFiles.length === 0) {
  fail('.forgejo/workflows/ has no workflow files — the gates have no execution entry point');
}

/**
 * Every `run:` step in the workflow's jobs, with its job and its full step
 * mapping. `uses:` steps run an action and cannot carry a shell command.
 */
function runSteps(doc) {
  const steps = [];
  for (const [jobId, job] of Object.entries(doc?.jobs ?? {})) {
    for (const step of job?.steps ?? []) {
      if (typeof step?.run !== 'string') continue;
      steps.push({
        jobId,
        label: step?.name,
        run: step.run,
        step,
        job,
        jobCondition: job?.if,
        jobNeeds: job?.needs,
      });
    }
  }
  return steps;
}

/**
 * Does this workflow provide pull-request coverage?
 *
 * Presence of the `pull_request` key is not enough. A filter decides whether the
 * workflow ever actually fires on a PR, and all of these keep the key while
 * making it unreachable: `types: [closed]` (only runs when a PR is closed),
 * `paths-ignore: ['**']` (never), `branches: [does-not-exist]`. The key would be
 * there and the gates would never run on an open pull request.
 */
function triggersOnPullRequest(doc) {
  const on = doc?.on;
  if (on === undefined && doc !== undefined && Object.hasOwn(doc, 'true')) {
    // A YAML 1.1 parser reads the bare key `on` as the boolean true. This checker
    // needs a YAML 1.2 (core schema) parser, which is what the `yaml` package is.
    // Failing here with the reason beats failing later with a confusing message.
    fail(
      '.forgejo/workflows/: the `on:` key parsed as boolean `true`, so a YAML 1.1 parser is in ' +
        'use. Use the `yaml` package (YAML 1.2 core schema) so triggers are readable',
    );
    return false;
  }
  // `on` parses as a string when written `on: push`, and as an object otherwise.
  if (typeof on === 'string') return on === 'pull_request';
  if (!on || typeof on !== 'object') return false;
  if (!('pull_request' in on)) return false;
  const pr = on.pull_request;
  // `pull_request:` with no value is the unfiltered form, which is what we want.
  if (pr === null || pr === undefined) return true;
  const filters = typeof pr === 'object' ? Object.keys(pr) : [];
  const restrictive = filters.filter((key) =>
    ['types', 'branches', 'branches-ignore', 'paths', 'paths-ignore'].includes(key),
  );
  return restrictive.length === 0;
}

/**
 * Is this job guaranteed to run on a pull request?
 *
 * `if:` is not always a string: `if: false` parses as the boolean `false`, which
 * a naive `typeof === 'string'` test collapses to "no condition" and thereby
 * treats a permanently dead job as live.
 *
 * The string test below is deliberately only used where a *best effort* answer
 * is enough. It cannot be sound: the condition is an expression, and
 * `${{ false && github.event_name == 'pull_request' }}` merely *contains* the
 * pull-request test while never being true. The step that actually carries the
 * PR tier is held to the stronger rule instead — no `if:` at all — so an
 * expression can never be mistaken for coverage.
 */
function jobRunsOnPullRequests(job) {
  const condition = job?.if;
  if (condition === undefined || condition === null) return true;
  // A bare boolean, or a non-string scalar, is a constant condition.
  if (typeof condition === 'boolean') return condition;
  if (typeof condition !== 'string') return false;
  if (/event_name\s*!=\s*'pull_request'/.test(condition)) return false;
  if (/refs\/heads\/|workflow_dispatch/.test(condition)) return false;
  return /event_name\s*==\s*'pull_request'/.test(condition);
}

const knownScripts = new Set();
for (const gate of GATES) for (const name of pnpmScriptsOf(gate)) knownScripts.add(name);
const nonGateScripts = new Set(NON_GATE_SCRIPTS);

/**
 * Files that define or verify the gates. A workflow must not read or write these.
 *
 * `scripts/check-all.sh` is deliberately absent: it is the tier command's target
 * and therefore appears in the one allowed place. The others are the machinery a
 * step could rewrite to turn every gate that follows into a no-op while the
 * workflow text still contains the byte-exact tier command. `scripts/check-all.mjs`
 * is listed because the shim now only executes that driver, so the driver is the
 * machinery.
 */
const GATE_MACHINERY = ['scripts/gates.mjs', 'scripts/check-ci-gates.mjs', 'scripts/check-all.mjs'];

// Every pnpm invocation in a `run:` body, so an unregistered gate-shaped script
// is still reported rather than silently allowed. `pnpm`/`pnpm run` only; a
// script name reached through a variable is not a gate by definition.
function pnpmScriptsIn(shell) {
  const names = [];
  for (const match of shell.matchAll(/\bpnpm(?:\s+run)?\s+([a-z][a-z0-9:_-]*)/g)) {
    names.push(match[1].replace(/[:-]+$/, ''));
  }
  return names;
}

// The gate list as it may appear in a workflow. A gate's `cmd` joined, plus its
// aliases, plus the bare script name. Used to detect a workflow naming a gate.
function gateSpellings() {
  const spellings = new Map();
  for (const gate of GATES) {
    for (const parts of [gate.cmd, ...(gate.aliases ?? [])]) {
      const text = parts.join(' ');
      if (!spellings.has(text)) spellings.set(text, gate.id);
    }
  }
  return spellings;
}
const gateText = gateSpellings();

/** A gate named anywhere in a run body, even inside a comment or a string. */
function namedGates(run) {
  const found = new Set();
  for (const [text, id] of gateText) {
    if (run.includes(text)) found.add(`${id} ("${text}")`);
  }
  // Also catch `pnpm <script>` for a script that belongs to a gate.
  for (const script of pnpmScriptsIn(/* raw text, comments included */ run)) {
    if (knownScripts.has(script) && !nonGateScripts.has(script)) {
      const owner = GATES.find((gate) => pnpmScriptsOf(gate).includes(script));
      if (owner) found.add(`${owner.id} ("pnpm ${script}")`);
    }
  }
  return [...found];
}

// Read the runner label from the fenced block that documents the registration
// command only. Scanning the whole document made the label hijackable by
// prose — a sentence like "do not use a stale registration such as
// `--labels ci-legacy:...`" would be adopted as the expected label, and every
// job could then be moved to a label no runner carries while reporting green.
const ciDoc = read(join(repoRoot, 'docs', 'ci.md'));
// `\r?\n` because the working copy is CRLF whenever core.autocrlf is on (the
// Windows default); an LF-only pattern matches no block at all there and the
// runner label silently reads as missing.
const registrationBlocks = [...ciDoc.matchAll(/```[a-z]*\r?\n([\s\S]*?)```/g)]
  .map((match) => match[1])
  .join('\n');
const runnerLabel = documentedRunnerLabel(registrationBlocks);
if (!runnerLabel) {
  fail(
    'docs/ci.md: could not find the runner label in a fenced code block. It must appear as ' +
      '`forgejo-runner register --labels <label>:...` inside a code block, so that prose cannot ' +
      'change which label the workflows are expected to use',
  );
}

/**
 * A gate-bearing step must actually run and actually be able to fail.
 *
 * This is the check that a text search cannot perform. A gate whose step carries
 * `continue-on-error: true`, whose job is `if: false`, or whose command ends in
 * `|| true` executes without ever failing the build — it looks present and
 * reports nothing. Since a tier command is the only path to the gates, refusing
 * these modifiers on that one step closes the whole class.
 */
function checkGateStepIsBlocking(file, step, what) {
  const where = `job "${step.jobId}" step "${step.label ?? '<unnamed>'}"`;
  const fail_ = (reason) =>
    fail(`.forgejo/workflows/${file}: ${where} ${reason} — the step that runs a gate tier must execute unconditionally and be able to fail, or ${what} are gated by nothing`);

  if (step.step['continue-on-error'] !== undefined) {
    fail_(`sets continue-on-error (${JSON.stringify(step.step['continue-on-error'])})`);
  }
  if (step.step.if !== undefined) {
    fail_(`has a step-level if (${JSON.stringify(step.step.if)})`);
  }
  if (/^\s*(exit\s+0|true)\b/m.test(step.run.replace(/^\s*(#.*)?$/gm, ''))) {
    fail_('contains `exit 0`/`true` before or instead of the command');
  }
  if (/\|\|\s*true\s*$/.test(step.run.trim())) {
    fail_('swallows the exit status with `|| true`');
  }
  if (/;\s*true\s*$/.test(step.run.trim()) || /^\s*set\s+\+e\b/m.test(step.run)) {
    fail_('disables shell error propagation (`set +e` or a trailing `; true`)');
  }
  if (/^\s*!\s/.test(step.run.trim())) {
    fail_('negates the command with a leading `!`');
  }

  // The job carrying the pull-request tier must be unconditional. Any `if:` at
  // all is refused, rather than pattern-matched: a condition is an expression,
  // and `${{ false && github.event_name == 'pull_request' }}` contains the
  // pull-request test while never being true. There is no way to tell that from
  // the honest form by reading the text, so the rule is "no condition".
  if (what === 'pull requests') {
    if (step.job?.if !== undefined) {
      fail_(
        `belongs to a job with an if-condition (${JSON.stringify(step.job.if)}). The job that runs ` +
          'the pull-request tier must be unconditional: an expression can contain the ' +
          "pull_request test and still never be true, and no text check can tell the difference",
      );
    } else if (!jobRunsOnPullRequests(step.job)) {
      fail_('belongs to a job that does not run on pull requests');
    }
  }
  if (step.jobNeeds !== undefined) {
    const needs = Array.isArray(step.jobNeeds) ? step.jobNeeds.join(', ') : String(step.jobNeeds);
    fail_(`belongs to a job with needs: [${needs}], so it can be skipped by an upstream job`);
  }
}

const sawPrTier = new Set();

for (const file of workflowFiles) {
  let doc;
  try {
    doc = parseYaml(read(join(workflowDir, file)));
  } catch (error) {
    fail(`.forgejo/workflows/${file}: not valid YAML (${error.message})`);
    continue;
  }
  if (!doc || typeof doc !== 'object') {
    fail(`.forgejo/workflows/${file}: does not parse to a mapping`);
    continue;
  }

  // (e) A job pinned to an unknown label can never be scheduled.
  for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
    const label = job?.['runs-on'];
    if (label === undefined) {
      fail(`.forgejo/workflows/${file}: job "${jobId}" has no runs-on`);
    } else if (label !== runnerLabel) {
      fail(
        `.forgejo/workflows/${file}: job "${jobId}" runs on "${label}" but docs/ci.md registers ` +
          `the runner as "${runnerLabel}" — a job on an unregistered label never runs`,
      );
    }
  }

  const steps = runSteps(doc);

  // (b) PR coverage must come from a workflow triggered on pull_request, and the
  //     step carrying it must be unconditionally executed and blocking. With one
  //     gate-bearing step per tier this is exactly checkable — which is the whole
  //     reason the workflows do not list gates individually.
  const prText = tierCommandText('pr');
  const fullText = tierCommandText('full');
  if (triggersOnPullRequest(doc)) {
    const carriers = steps.filter((step) => step.run.trim() === prText);
    if (carriers.length === 0) {
      fail(
        `.forgejo/workflows/${file}: triggers on pull_request but no step runs ` +
          `"${prText}" verbatim — PRs would not run the pr gate tier`,
      );
    }
    for (const carrier of carriers) {
      checkGateStepIsBlocking(file, carrier, 'pull requests');
    }
    if (carriers.length > 0) sawPrTier.add(file);
  }

  // (c) Any step invoking check-all.sh must match a tier command exactly, and any
  //     step that matches a tier command must be blocking. This covers the full
  //     tier wherever it lives, and catches a tier command with anything appended.
  for (const step of steps) {
    const trimmed = step.run.trim();
    const isTierCommand = trimmed === prText || trimmed === fullText;
    if (!isTierCommand && step.run.includes('check-all.sh')) {
      fail(
        `.forgejo/workflows/${file}: job "${step.jobId}" step "${step.label ?? '<unnamed>'}" runs ` +
          `check-all.sh but not as a tier command verbatim — expected one of ` +
          `"${prText}" or "${fullText}"`,
      );
    }
    if (isTierCommand) checkGateStepIsBlocking(file, step, 'the gate tier it runs');
  }

  // (d) No step may name an individual gate. This is what makes the tier command
  //     the only path to a gate, and it holds even for comments and dead code,
  //     because the check is on the raw text.
  for (const step of steps) {
    // The tier command itself is not a gate name; skip it for the naming scan so
    // the two rules cannot contradict each other.
    if (step.run.trim() === prText || step.run.trim() === fullText) continue;
    const named = namedGates(step.run);
    if (named.length > 0) {
      fail(
        `.forgejo/workflows/${file}: job "${step.jobId}" step "${step.label ?? '<unnamed>'}" names ` +
          `gate(s) ${named.join(', ')} — workflows must run a whole tier via ` +
          `"${prText}" / "${fullText}" and name no gate, so that no gate can be ` +
          'disabled one at a time',
      );
    }
    // A gate-shaped script that is neither registered nor a declared non-gate.
    for (const script of pnpmScriptsIn(step.run)) {
      if (knownScripts.has(script) || nonGateScripts.has(script)) continue;
      fail(
        `.forgejo/workflows/${file}: job "${step.jobId}" runs "pnpm ${script}", which is neither a ` +
          'registered gate in scripts/gates.mjs nor a declared non-gate step',
      );
    }
    // No step may touch the gate machinery. A step above the tier that rewrites
    // `scripts/gates.mjs` leaves a byte-exact tier command and a clean registry
    // check while every gate becomes a no-op — demonstrated. The machinery is
    // read-only from a workflow's point of view.
    for (const machinery of GATE_MACHINERY) {
      if (step.run.includes(machinery)) {
        fail(
          `.forgejo/workflows/${file}: job "${step.jobId}" step "${step.label ?? '<unnamed>'}" ` +
            `references the gate machinery (${machinery}). Workflows invoke a tier command; they must ` +
            'not read or rewrite the scripts that define and verify the gates, because a step that ' +
            'rewrites them disarms every gate that follows while the workflow text looks correct',
        );
      }
    }
  }
}

if (sawPrTier.size === 0) {
  fail(
    '.forgejo/workflows/: no workflow both triggers on pull_request and runs the pr gate tier — ' +
      'pull requests would be gated by nothing',
  );
}

// (f) The full tier must be exercised somewhere automated, or the slow gates
//     only exist on a maintainer's laptop.
const fullTierRan = workflowFiles.some((file) => {
  try {
    const doc = parseYaml(read(join(workflowDir, file)));
    return runSteps(doc).some((step) => step.run.trim() === tierCommandText('full'));
  } catch {
    return false;
  }
});
if (!fullTierRan) {
  fail(
    `.forgejo/workflows/: no workflow runs "${tierCommandText('full')}" — the full gate tier ` +
      '(build:web, e2e, perf-check, cargo deny) would only ever run on a maintainer machine',
  );
}


// ── 5. The updater must not point at a different forge than the release job ──
//
// The previous pipeline built releases on Codeberg while the in-app updater read
// `github.com/Horldsence/lissio`, which returns 404 — so updates silently never
// arrived. That mismatch was invisible because nothing compared the two. This
// check fails when the manifest host and the publish host disagree, and rejects
// GitHub's `releases/latest/download/...` pseudo-path, which Codeberg does not
// implement (measured: that path 404s even for an asset that exists).
const updateRs = join(repoRoot, 'client/src-tauri/crates/update_flow/src/update.rs');
const tauriConf = join(repoRoot, 'client/src-tauri/tauri.conf.json');
if (existsSync(updateRs)) {
  const text = read(updateRs);
  const urls = [...text.matchAll(/"(https:\/\/[^"]*\.json)"/g)].map((m) => m[1]);
  if (urls.length === 0) {
    fail('update_flow/src/update.rs: no manifest URL found; the updater needs a static manifest URL');
  }
  for (const url of urls) {
    if (url.includes('github.com')) {
      fail(
        `update_flow/src/update.rs: manifest URL still points at github.com (${url}) — ` +
          'this repository is hosted on Codeberg; that host returns 404',
      );
    }
    if (/\/releases\/latest\/download\//.test(url)) {
      fail(
        `update_flow/src/update.rs: ${url} uses GitHub's "releases/latest/download" pseudo-path, ` +
          'which Codeberg does not implement (it returns 404). Use a fixed rolling tag such as ' +
          '/releases/download/stable/latest.json',
      );
    }
  }
  if (existsSync(tauriConf)) {
    const conf = JSON.parse(read(tauriConf));
    const endpoints = conf?.plugins?.updater?.endpoints;
    if (Array.isArray(endpoints) && endpoints.length > 0) {
      const endpointHost = new URL(endpoints[0]).host;
      if (!urls.some((url) => new URL(url).host === endpointHost)) {
        fail(
          `client/src-tauri/tauri.conf.json: updater endpoint host "${endpointHost}" does not match any ` +
            'manifest host in update_flow/src/update.rs — the config and the code disagree',
        );
      }
    }
  }
}

// ── 6. Release scripts must keep the tag and host conventions ──
//
// `scripts/auto-build.sh` derives the next version from `git tag --list 'v[0-9]*'`,
// so a release published under an unprefixed tag is invisible to the bump logic
// and can produce a next version lower than the one already shipped. Six such
// tags exist from before this rule; they are immutable, but new ones must not
// be created. See docs/ci.md "Tag naming".
const publishScript = join(repoRoot, 'scripts/publish-release.mjs');
if (existsSync(publishScript)) {
  const publishText = read(publishScript);
  // Anchor on the tag definition itself. A loose "does `v${version}` appear
  // anywhere" test gives a false pass, because the manifest `notes` and the
  // release body also interpolate the version.
  const tagAssignment = /const\s+TAG\s*=\s*`([^`]*)`/.exec(publishText);
  if (!tagAssignment) {
    fail('scripts/publish-release.mjs: no `const TAG = ...` definition found');
  } else if (tagAssignment[1] !== 'v${version}') {
    fail(
      `scripts/publish-release.mjs: release tag is \`${tagAssignment[1]}\` but must be ` +
        '`v${version}` (vX.Y.Z) — an unprefixed tag is invisible to the version bump in ' +
        "scripts/auto-build.sh (`v[0-9]*`)",
    );
  }
  if (!publishText.includes('codeberg.org')) {
    fail('scripts/publish-release.mjs: release URLs must point at codeberg.org, not another forge');
  }
  // Only real code matters: the doc comments deliberately name the forbidden
  // "releases/latest/download" path in order to explain why it must not be used.
  const codeOnly = publishText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  if (/releases\/latest\/download/.test(codeOnly)) {
    fail(
      'scripts/publish-release.mjs: uses the "releases/latest/download" pseudo-path, which ' +
        'Codeberg does not implement (it returns 404)',
    );
  }
}

// ── Result ────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error('✗ CI gate drift detected:\n');
  for (const error of errors) console.error(`  - ${error}`);
  console.error('\nThe single source of truth is scripts/gates.mjs. Change it there, then sync docs and workflows.');
  process.exit(1);
}

// Count only things that can actually fail. Listing an informational command in
// the gate total would overstate how much is enforced.
const enforcing = GATES.filter((gate) => !gate.informational);
const prCount = gatesFor('pr').filter((gate) => !gate.informational).length;
const informationalCount = GATES.length - enforcing.length;
const informational = informationalCount > 0 ? `, ${informationalCount} informational` : '';
console.log(
  `✓ CI gates consistent — ${enforcing.length} gates (${prCount} on PR)${informational}, ` +
    `${workflowFiles.length} workflow(s), ${documentedDocs.length} generated doc block(s) verified`,
);
