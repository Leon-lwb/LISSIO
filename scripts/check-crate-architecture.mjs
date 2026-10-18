#!/usr/bin/env node
/**
 * check-crate-architecture.mjs — Rust workspace architecture gate.
 *
 * Enforces, from `[package.metadata.lissio]` and the crate layout:
 *   - every member lives at `<crate root>/<domain>/<crate>` and names itself after the directory,
 *     where the crate roots are `crates/` plus the nested `core/`, `physical/`, and `data/`
 *     submodule roots of the umbrella's `server/` workspace;
 *   - metadata is complete and the responsibility is not the placeholder;
 *   - the documented domain/layer matrix in `server/docs/architecture/crates.md` matches the metadata;
 *   - dependencies follow the domain DAG and never point at a higher layer;
 *   - L0-L3 crates depend only on reviewed external (crates.io) packages
 *     (`scripts/lower-layer-external-dependencies.json`);
 *   - tests are flat files, not inline `#[cfg(test)] mod x { ... }` blocks or
 *     test-only directories.
 *
 * Repository-root convention (`scripts/repo-root.mjs`): the Rust workspace of the repository
 * the script runs in — `server/` inside the umbrella, the repository itself inside a copy —
 * and `--root=<path>` selects another checkout. The two files this gate reads do not live
 * below the same root, because they belong to different repositories: the documented layer
 * matrix `server/docs/architecture/crates.md` is owned by the Rust repository, so it is resolved
 * below the workspace root, while the reviewed external-dependency baseline
 * `scripts/lower-layer-external-dependencies.json` belongs to the repository that owns this
 * gate and stays below the repository root.
 *
 * Usage:
 *   pnpm check:architecture [--root=<path>]
 *   node scripts/check-crate-architecture.mjs --update-baseline
 *     Rewrite the reviewed lower-layer external-dependency baseline after a
 *     deliberate, reviewed dependency change. Never a fix for a gate failure.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { repositoryRoot, rustSourceRoots, rustWorkspaceRoot, rustWorkspaceRoots } from './repo-root.mjs';

const root = repositoryRoot();
/** The Rust workspace: `<repo>/server` inside the umbrella, `<repo>` in a copy. */
const workspaceRoot = rustWorkspaceRoot(root);
/**
 * Every Cargo workspace the gate covers: the repository's own workspace plus the
 * nested `core/`, `physical/`, and `data/` submodules, which declare `[workspace]`
 * roots of their own and are excluded from the server workspace's member globs. A
 * crate can only be judged from the metadata of the workspace that owns it.
 */
const WORKSPACE_ROOTS = rustWorkspaceRoots(root);
const WORKSPACE_MANIFESTS = new Set(WORKSPACE_ROOTS.map((workspace) => path.join(workspace, 'Cargo.toml')));
/** Every directory a member crate may sit under, `<domain>/<crate>` deep. */
const CRATE_ROOTS = rustSourceRoots(workspaceRoot).map((scanRoot) => path.join(workspaceRoot, scanRoot));
/**
 * The documented layer matrix is owned by the Rust repository, not by the umbrella: inside
 * the umbrella it lives at `server/docs/architecture/crates.md`, and inside a copy of this
 * gate in the `server` repository the workspace root *is* the repository root, so the suffix
 * below is the same. Hard-coding the umbrella-relative path here would break the moment the
 * document moves to the repository that owns it — which is what happened.
 */
const LAYER_TABLE_DOC = path.join(workspaceRoot, 'docs', 'architecture', 'crates.md');
const EXTERNAL_DEPENDENCY_BASELINE = path.join(root, 'scripts', 'lower-layer-external-dependencies.json');
const BASELINE_DESCRIPTION =
  'Reviewed external (crates.io) dependencies of L0-L3 crates. Lower layers may depend only on ' +
  'packages listed here, so a new adapter SDK or OS facility has to be reviewed rather than ' +
  'slip in. Regenerate with `node scripts/check-crate-architecture.mjs --update-baseline` after ' +
  'a deliberate change. Dev-dependencies are not listed: they do not ship.';

const domains = new Set(['shared', 'signal', 'vehicle', 'protocol', 'graph', 'transport', 'data', 'workspace', 'ai', 'application', 'integration', 'desktop']);
const allowedDomains = {
  shared: [], signal: ['shared'], vehicle: ['shared'], protocol: ['shared', 'vehicle'],
  graph: ['shared', 'signal', 'protocol'], transport: ['shared', 'vehicle', 'protocol'],
  data: ['shared', 'signal', 'vehicle', 'protocol', 'transport', 'graph'],
  workspace: ['shared', 'graph'], ai: ['shared'],
  application: ['shared', 'signal', 'vehicle', 'protocol', 'graph', 'transport', 'data', 'workspace'],
  integration: ['shared', 'signal', 'vehicle', 'protocol', 'graph', 'application', 'ai'],
  desktop: [...domains],
};
// Lib/bin target names carry the responsibility naming; the `lissio-` prefix is
// reserved for the crates.io package name (registry namespace) and must never
// appear on a target name.
const bannedTargetNames = /^(?:core|runtime|types|common)$|^(?:lissio|vofa)-/;
// Tests live in files, not inline in production modules and not in directories
// created to hold them: unit tests that need private access go in a flat
// `<module>_tests.rs` file beside `<module>.rs`, and a `tests/`/`benches/`
// directory is reserved for grouped suites and public-API integration tests.
// See server/docs/architecture/crates.md.
const inlineTestModule = /^(?:pub\s+)?mod\s+\w+\s*\{/;
/** The `#[cfg(test)]` attribute, wherever it starts once the line is trimmed. */
const CFG_TEST_ATTRIBUTE = /^#\[cfg\(test\)\]/;
const PLACEHOLDER_RESPONSIBILITY = 'Focused crate responsibility';

/**
 * The text of the item that follows the `#[cfg(test)]` at `index`.
 *
 * The attribute used to be recognized only when a line was *exactly*
 * `#[cfg(test)]`, so `#[cfg(test)] mod tests {` on one line — or the attribute
 * with a trailing comment — escaped the documented rule while an inline test
 * module sat in production code. The attribute may also be followed by more
 * attributes on later lines, so comments are stripped and leading attributes
 * are skipped until the first real token.
 */
export function firstItemAfterCfgTest(lines, index) {
  const window = [
    lines[index].trim().replace(CFG_TEST_ATTRIBUTE, ''),
    ...lines.slice(index + 1, index + 40),
  ].join('\n');
  let text = window.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  for (;;) {
    text = text.replace(/^\s+/, '');
    if (text === '') return '';
    if (!text.startsWith('#')) return text;
    const attribute = /^#!?\[[^[\]]*\]/.exec(text);
    if (attribute === null) return text;
    text = text.slice(attribute[0].length);
  }
}

/** True when the `#[cfg(test)]` at `index` directly declares a brace-delimited test module. */
export function declaresInlineTestModule(lines, index) {
  return inlineTestModule.test(firstItemAfterCfgTest(lines, index));
}

/**
 * Parse the `| Domain | Layers present |` matrix from `server/docs/architecture/crates.md`.
 *
 * Returns `{ crates: Map<name, { domain, layer }>, domains: Map<domain, Set<layer>> }`
 * or null when the table cannot be found. The table names each domain-grouped
 * crate under the layer it must declare, which is what makes the document a
 * checked expectation rather than prose.
 */
export function parseLayerTable(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const header = lines.findIndex((line) => /^\|\s*Domain\s*\|\s*Layers present\s*\|$/.test(line.trim()));
  if (header === -1) return null;
  const crates = new Map();
  const domainLayers = new Map();
  for (let index = header + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith('|')) break;
    if (/^\|[\s:|-]+\|$/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const [domain, layers] = cells;
    if (!domains.has(domain)) continue;
    for (const match of layers.matchAll(/L(\d+)\s*:\s*([^;]+)/g)) {
      const layer = Number(match[1]);
      if (!domainLayers.has(domain)) domainLayers.set(domain, new Set());
      domainLayers.get(domain).add(layer);
      for (const crate of match[2].matchAll(/`([^`]+)`/g)) crates.set(crate[1], { domain, layer });
    }
  }
  return crates.size > 0 ? { crates, domains: domainLayers } : null;
}

/**
 * Every external (non-workspace) dependency of an L0-L3 crate, minus dev-only
 * dependencies. Sorted per crate and by crate name so the baseline is stable.
 */
export function lowerLayerExternalDependencies(packages, byName) {
  const lower = packages.filter((pkg) => {
    const architecture = pkg.metadata?.lissio;
    return architecture && Number.isInteger(architecture.layer) && architecture.layer <= 3;
  });
  const result = new Map();
  for (const pkg of lower) {
    const external = [...new Set(pkg.dependencies
      .filter((dependency) => dependency.kind !== 'dev')
      .filter((dependency) => !byName.has(dependency.name))
      .map((dependency) => dependency.name))].sort();
    if (external.length > 0) result.set(pkg.name, external);
  }
  return new Map([...result.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function relativeToRoot(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

/** Cargo marks its build directory with `CACHEDIR.TAG`; a module directory may
 * legitimately be named `target`, so the marker decides instead of the name. */
function isBuildDirectory(dir) {
  return existsSync(path.join(dir, 'CACHEDIR.TAG'));
}

const TEST_FILE = /^(?:tests\.rs|.*_tests\.rs)$/;
const SKIP_DIR_NAMES = new Set(['node_modules']);

function inTestSuite(relative) {
  const parts = relative.split('/');
  return parts.includes('tests') || parts.includes('benches');
}

function isTestPath(relative) {
  return inTestSuite(relative) || TEST_FILE.test(relative.split('/').at(-1));
}

function walkRust(dir, files = [], dirs = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { files, dirs };
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const child = path.join(dir, entry.name);
      if (isBuildDirectory(child)) continue;
      dirs.push(child);
      walkRust(child, files, dirs);
    } else if (entry.name.endsWith('.rs')) {
      files.push(path.join(dir, entry.name));
    }
  }
  return { files, dirs };
}

/** Every package check that only needs manifest metadata. Collects into `errors`. */
function checkPackages(packages, byName, errors) {
  for (const pkg of packages) {
    const manifest = path.resolve(pkg.manifest_path);
    const isRoot = WORKSPACE_MANIFESTS.has(manifest);
    if (isRoot) continue;
    const architecture = pkg.metadata?.lissio;
    const crateDir = path.dirname(manifest);
    const crateRoot = CRATE_ROOTS.find((base) => crateDir.startsWith(`${base}${path.sep}`));
    const relative = crateRoot === undefined
      ? []
      : path.relative(crateRoot, crateDir).split(path.sep);
    if (relative.length !== 2) {
      errors.push(
        `${pkg.name}: expected <crate root>/<domain>/<crate> — found ` +
          `${path.relative(workspaceRoot, crateDir).split(path.sep).join('/') || '<workspace root>'}`,
      );
    }
    if (!architecture || !domains.has(architecture.domain) || !Number.isInteger(architecture.layer) || !architecture.responsibility?.trim()) {
      errors.push(`${pkg.name}: incomplete [package.metadata.lissio]`);
      continue;
    }
    if (architecture.responsibility.trim() === PLACEHOLDER_RESPONSIBILITY) {
      errors.push(`${pkg.name}: responsibility is still the placeholder — state the crate's actual abstraction`);
    }
    const directoryName = relative[1] ?? path.basename(crateDir);
    if (relative[0] !== architecture.domain) errors.push(`${pkg.name}: directory domain and metadata domain differ`);
    const libTarget = pkg.targets.find((target) => target.kind.includes('lib'));
    if (libTarget?.name !== directoryName.replace(/-/g, '_')) errors.push(`${pkg.name}: lib target must match directory name (${directoryName.replace(/-/g, '_')})`);
    const expectedPackageName = `lissio-${directoryName.replace(/_/g, '-')}`;
    if (pkg.name !== expectedPackageName) errors.push(`${pkg.name}: package name must be ${expectedPackageName}`);
    if (libTarget && bannedTargetNames.test(libTarget.name)) errors.push(`${pkg.name}: forbidden ambiguous or prefixed crate name`);
    for (const dependency of pkg.dependencies) {
      const target = byName.get(dependency.name);
      if (target && target.id !== pkg.id) {
        const targetArchitecture = target.metadata?.lissio;
        if (!targetArchitecture) continue;
        // Test-only dependencies may cross production boundaries; they do not
        // become part of the shipped dependency graph.
        if (dependency.kind !== 'dev') {
          if (targetArchitecture.layer > architecture.layer) errors.push(`${pkg.name}: L${architecture.layer} cannot depend on ${target.name} L${targetArchitecture.layer}`);
          if (targetArchitecture.domain !== architecture.domain && !allowedDomains[architecture.domain].includes(targetArchitecture.domain)) {
            errors.push(`${pkg.name}: ${architecture.domain} cannot depend on ${target.name} (${targetArchitecture.domain})`);
          }
        }
        if (target.name === 'lissio-graph-testkit' && dependency.kind !== 'dev') errors.push(`${pkg.name}: graph-testkit must be a dev-dependency`);
      }
      if (dependency.name.startsWith('tauri') && architecture.domain !== 'desktop') errors.push(`${pkg.name}: Tauri is restricted to the desktop domain`);
    }
  }
}

/**
 * The per-crate layer table in server/docs/architecture/crates.md is the documented
 * expectation the metadata is checked against.
 *
 * The document claimed `check:architecture` enforced the matrix, but nothing
 * read it: a crate could declare any layer it liked, and because the adapter
 * rule is conditioned on that declaration, declaring `layer = 4` on an L1/L2
 * crate would silently remove it from that rule. The metadata stays
 * authoritative; this makes the document the checked copy.
 */
function checkLayerTable(packages, errors) {
  const table = existsSync(LAYER_TABLE_DOC) ? parseLayerTable(readFileSync(LAYER_TABLE_DOC, 'utf8')) : null;
  if (table === null) {
    errors.push(
      'server/docs/architecture/crates.md: cannot find the "| Domain | Layers present |" table — the documented crate-to-layer matrix must exist so it can be enforced',
    );
    return 0;
  }
  const documented = new Set();
  for (const pkg of packages) {
    const architecture = pkg.metadata?.lissio;
    if (!architecture || !Number.isInteger(architecture.layer)) continue;
    const isRoot = WORKSPACE_MANIFESTS.has(path.resolve(pkg.manifest_path));
    if (isRoot) {
      // The composition root is not a `crates/<domain>/<crate>` member, so the
      // table does not name it; its domain/layer pair must still be documented.
      if (!table.domains.get(architecture.domain)?.has(architecture.layer)) {
        errors.push(
          `${pkg.name}: L${architecture.layer} is not a documented layer of the ${architecture.domain} domain in server/docs/architecture/crates.md`,
        );
      }
      continue;
    }
    const key = pkg.name.replace(/^lissio-/, '');
    documented.add(key);
    const entry = table.crates.get(key);
    if (entry === undefined) {
      errors.push(
        `server/docs/architecture/crates.md: no "| Domain | Layers present |" entry names ${key} — every workspace member must appear in the documented matrix`,
      );
      continue;
    }
    if (entry.layer !== architecture.layer) {
      errors.push(
        `${pkg.name}: metadata declares L${architecture.layer} but server/docs/architecture/crates.md documents L${entry.layer}; make the document match the authoritative metadata`,
      );
    }
    if (entry.domain !== architecture.domain) {
      errors.push(
        `${pkg.name}: metadata declares domain ${architecture.domain} but server/docs/architecture/crates.md lists it under ${entry.domain}`,
      );
    }
  }
  for (const key of table.crates.keys()) {
    if (!documented.has(key)) {
      errors.push(`server/docs/architecture/crates.md: documented crate "${key}" is not a workspace member — remove or rename the stale row`);
    }
  }
  return table.crates.size;
}

/**
 * L0-L3 external dependencies are a reviewed inventory, not a denylist.
 *
 * server/docs/architecture/crates.md states the general rule "L0-L3 must not depend on
 * Tauri or adapter SDKs / OS facilities", but the enforcement used to be a
 * hardcoded seven-name denylist — so any other adapter SDK or OS API reached
 * from a lower layer passed silently. One does: `lissio-control-api` (L3)
 * depends on `windows-sys` directly for file-time conversion. A denylist cannot
 * be complete, so the rule is inverted: a lower-layer crate may depend only on
 * the external packages recorded in the committed, generated baseline. Adding
 * one is a deliberate edit with review visibility; a new adapter SDK or OS
 * facility in L0-L3 fails until the baseline is regenerated on purpose.
 */
function checkExternalDependencyBaseline(packages, byName, updateBaseline, errors) {
  const actual = lowerLayerExternalDependencies(packages, byName);
  const edges = [...actual.values()].reduce((total, dependencies) => total + dependencies.length, 0);
  if (updateBaseline) {
    const payload = { description: BASELINE_DESCRIPTION, crates: Object.fromEntries(actual) };
    writeFileSync(EXTERNAL_DEPENDENCY_BASELINE, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(
      `updated ${relativeToRoot(EXTERNAL_DEPENDENCY_BASELINE)} — ${actual.size} crate(s), ${edges} external dependency edge(s)`,
    );
    return { crates: actual.size, edges };
  }
  if (!existsSync(EXTERNAL_DEPENDENCY_BASELINE)) {
    errors.push(
      `scripts/lower-layer-external-dependencies.json is missing — the reviewed L0-L3 external dependency baseline ` +
        'must be committed; create it with `node scripts/check-crate-architecture.mjs --update-baseline` after review',
    );
    return { crates: 0, edges: 0 };
  }
  let recorded;
  try {
    recorded = new Map(Object.entries(JSON.parse(readFileSync(EXTERNAL_DEPENDENCY_BASELINE, 'utf8')).crates ?? {}));
  } catch (error) {
    errors.push(`scripts/lower-layer-external-dependencies.json: cannot be parsed (${error.message})`);
    return { crates: 0, edges: 0 };
  }
  const seen = new Set();
  for (const [crate, dependencies] of actual) {
    seen.add(crate);
    const allowed = recorded.get(crate) ?? [];
    const added = dependencies.filter((dependency) => !allowed.includes(dependency));
    const removed = allowed.filter((dependency) => !dependencies.includes(dependency));
    if (added.length > 0) {
      errors.push(
        `${crate}: L0-L3 external dependenc${added.length === 1 ? 'y' : 'ies'} not in the reviewed baseline: ` +
          `${added.join(', ')} — lower layers may not depend on an unreviewed adapter SDK or OS facility. Remove ` +
          'it, define a port below the adapter, or regenerate the baseline deliberately after review',
      );
    }
    if (removed.length > 0) {
      errors.push(
        `${crate}: the reviewed baseline still lists ${removed.join(', ')} but the crate no longer depends on it — ` +
          'regenerate the baseline so it remains the reviewed inventory',
      );
    }
  }
  for (const crate of recorded.keys()) {
    if (!seen.has(crate)) {
      errors.push(
        `scripts/lower-layer-external-dependencies.json: "${crate}" is not an L0-L3 crate with external ` +
          'dependencies — regenerate the baseline so it remains the reviewed inventory',
      );
    }
  }
  return { crates: recorded.size, edges };
}

/** Test layout: no inline `#[cfg(test)] mod x { ... }`, no test-only directories. */
function checkTestLayout(errors) {
  let scannedSources = 0;
  let scannedDirectories = 0;
  for (const scanRoot of CRATE_ROOTS) {
    const { files, dirs } = walkRust(scanRoot);
    for (const dir of dirs) {
      const relativeDir = path.relative(workspaceRoot, dir).split(path.sep).join('/');
      if (inTestSuite(relativeDir)) continue;
      let rustFiles;
      try {
        rustFiles = readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.rs'))
          .map((entry) => entry.name);
      } catch {
        continue;
      }
      if (rustFiles.length === 0) continue;
      scannedDirectories += 1;
      if (rustFiles.every((name) => TEST_FILE.test(name))) {
        errors.push(`${relativeDir}: test-only directory — keep module tests in a flat <module>_tests.rs file beside <module>.rs`);
      }
    }
    for (const file of files) {
      const relative = path.relative(workspaceRoot, file).split(path.sep).join('/');
      if (isTestPath(relative)) continue;
      scannedSources += 1;
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        if (!CFG_TEST_ATTRIBUTE.test(lines[index].trim())) continue;
        if (declaresInlineTestModule(lines, index)) {
          errors.push(`${relative}:${index + 1}: inline #[cfg(test)] module — move tests into a flat <module>_tests.rs file beside <module>.rs`);
        }
      }
    }
  }
  if (scannedSources === 0) errors.push('scanned 0 Rust source files — cannot evaluate the test layout rule');
  if (scannedDirectories === 0) errors.push('scanned 0 Rust source directories — cannot evaluate the test-only directory rule');
  return { scannedSources, scannedDirectories };
}

/**
 * Every workspace member across every Cargo workspace in the checkout.
 *
 * `server/`'s workspace lists only its own members, while `core/`, `physical/`, and
 * `data/` are excluded from it (they declare `[workspace]` roots of their own).
 * Reading one manifest therefore saw roughly half the crates and reported the rest
 * as undocumented. Merging the metadata of each workspace is also what makes the
 * dependency rules meaningful again: a server crate that depends on a core crate is
 * an internal edge, not an external one.
 */
function workspacePackages() {
  const byId = new Map();
  for (const workspace of WORKSPACE_ROOTS) {
    const metadata = JSON.parse(execFileSync('cargo', [
      'metadata', '--format-version', '1', '--no-deps', '--manifest-path', path.join(workspace, 'Cargo.toml'),
    ], { encoding: 'utf8' }));
    const members = new Set(metadata.workspace_members);
    for (const pkg of metadata.packages) {
      if (members.has(pkg.id)) byId.set(pkg.id, pkg);
    }
  }
  return [...byId.values()];
}

function main() {
  const argv = process.argv.slice(2);
  const updateBaseline = argv.includes('--update-baseline');
  const packages = workspacePackages();
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const errors = [];

  checkPackages(packages, byName, errors);
  const documentedCrates = checkLayerTable(packages, errors);
  const baseline = checkExternalDependencyBaseline(packages, byName, updateBaseline, errors);
  const { scannedSources, scannedDirectories } = checkTestLayout(errors);

  if (errors.length) {
    console.error(`Architecture check failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join('\n')}`);
    process.exit(1);
  }
  // A workspace root manifest may or may not carry a package: `server/`,
  // `server/core/`, `server/physical/`, and `server/data/` are virtual today, but a
  // root package is allowed and is not a `<crate root>/<domain>/<crate>` member.
  // Count whatever is actually there rather than assuming the pre-split root package.
  const rootPackages = packages.filter((pkg) => WORKSPACE_MANIFESTS.has(path.resolve(pkg.manifest_path)));
  const roots = rootPackages.length > 0
    ? ` + ${rootPackages.map((pkg) => pkg.name).join(', ')} composition root${rootPackages.length === 1 ? '' : 's'}`
    : '';
  console.log(
    `Architecture check passed: ${packages.length - rootPackages.length} domain-grouped crates${roots} across ` +
      `${WORKSPACE_ROOTS.length} Cargo workspace(s), ` +
      `${scannedSources} production Rust files and ${scannedDirectories} module directories with flat, non-inline tests; ` +
      `${documentedCrates} documented crate row(s) match the workspace metadata, and ${baseline.edges} lower-layer ` +
      `external dependency edge(s) across ${baseline.crates} crate(s) are in the reviewed baseline.`,
  );
}

// Importing this module for its helpers (the self-test) must not run the gate.
const invokedPath = process.argv[1] === undefined ? null : path.resolve(process.argv[1]);
if (invokedPath !== null && invokedPath === fileURLToPath(import.meta.url)) main();
