#!/usr/bin/env node
/**
 * check-tauri-versions.mjs — the Tauri npm packages and the Rust crates must agree
 *
 * Why this file exists: `tauri dev` and `tauri build` abort before they build
 * anything when a Tauri npm package and its Rust crate are on different
 * major/minor releases (`tauri-cli`'s `check_mismatched_packages`, which also
 * prints the mismatch from `tauri info`). Nothing else here looked at that
 * pairing — the type check, the lint, the unit tests, and every other gate stay
 * green while `pnpm dev:desktop` refuses to start.
 *
 * That is how `@tauri-apps/api@2.12` / `@tauri-apps/plugin-opener@2.7` came to
 * sit next to `tauri@2.11.5` / `tauri-plugin-opener@2.5.5` with no gate objecting.
 *
 * Rules:
 *   1. `@tauri-apps/api` must share a major/minor with the `tauri` crate;
 *   2. every `@tauri-apps/plugin-<name>` declared in `package.json` must share a
 *      major/minor with the `tauri-plugin-<name>` crate.
 *
 * Both sides are read the way `tauri dev` reads them: the npm side from the
 * version installed under the application's `node_modules` (what the CLI
 * resolves with `pnpm list <name> --depth 0`), the Rust side from the version
 * resolved in `client/src-tauri/Cargo.lock`. A declared package whose Rust crate
 * is absent from the lockfile is skipped, exactly as the CLI skips an unpaired
 * plugin, and `@tauri-apps/cli` is not a pair because no crate in the
 * application's dependency tree corresponds to it.
 *
 * The Tauri application is the `client/` submodule, so `--root=<path>` may name
 * the checkout to inspect; with no argument the repository that owns this script
 * is used and `client/` is resolved inside it (`scripts/repo-root.mjs`), which
 * keeps the gate working both from the umbrella and from a copy inside
 * `client/`.
 *
 * Usage: pnpm check:tauri-versions
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { frontendRoot, repositoryRoot } from './repo-root.mjs';

const repoRoot = repositoryRoot();
/** The Tauri application: the `client/` submodule, or the repository itself when copied there. */
const clientRoot = frontendRoot(repoRoot);
const errors = [];

/** Repository-relative display path, so a message names the same file a reader sees. */
const label = (path) => relative(repoRoot, path).split(sep).join('/') || path;

/** The `major.minor` release of a semver string. */
function majorMinor(version) {
  const match = /^(\d+)\.(\d+)/.exec(version);
  return match ? `${match[1]}.${match[2]}` : version;
}

/** Numeric ordering, so several locked versions can be ranked. */
function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

// ---- The Rust side: versions resolved in client/src-tauri/Cargo.lock ----
const lockPath = join(clientRoot, 'src-tauri', 'Cargo.lock');
if (!existsSync(lockPath)) {
  console.error(
    `✗ Tauri npm/crate version check cannot run: ${label(lockPath)} is missing. The gate compares\n` +
      '  the npm packages against the crates `tauri dev` resolves, so it needs that lockfile; a\n' +
      '  checkout without it must fail here rather than pass vacuously.',
  );
  process.exit(1);
}
const lockLabel = label(lockPath);
const lockText = readFileSync(lockPath, 'utf8');

/** Every version of `name` the lockfile records, newest first. */
function lockedVersions(name) {
  const versions = [];
  for (const block of lockText.split(/^\[\[package\]\]\s*$/m)) {
    const packageName = /^name = "([^"]+)"$/m.exec(block);
    if (!packageName || packageName[1] !== name) continue;
    const version = /^version = "([^"]+)"$/m.exec(block);
    if (version) versions.push(version[1]);
  }
  return versions.sort(compareVersions).reverse();
}

// ---- The npm side: the Tauri packages the application declares ----
const pkg = JSON.parse(readFileSync(join(clientRoot, 'package.json'), 'utf8'));
const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

/** Each entry pairs a Tauri npm package with the crate the CLI compares it to. */
const pairs = [];
if ('@tauri-apps/api' in declared) pairs.push({ npm: '@tauri-apps/api', crate: 'tauri' });
for (const name of Object.keys(declared)) {
  const plugin = /^@tauri-apps\/plugin-(.+)$/.exec(name);
  if (plugin) pairs.push({ npm: name, crate: `tauri-plugin-${plugin[1]}` });
}

/** The version installed under node_modules, or null when it is not installed. */
function installedVersion(name) {
  const manifest = join(clientRoot, 'node_modules', ...name.split('/'), 'package.json');
  if (!existsSync(manifest)) return null;
  return JSON.parse(readFileSync(manifest, 'utf8')).version;
}

let checked = 0;
for (const pair of pairs) {
  const crateVersions = lockedVersions(pair.crate);
  // No crate in the application's dependency tree: the CLI does not pair this
  // package either, so there is nothing to compare.
  if (crateVersions.length === 0) continue;

  const npmVersion = installedVersion(pair.npm);
  if (npmVersion === null) {
    errors.push(
      `${pair.npm} is declared in package.json but not installed under node_modules — run ` +
        `\`pnpm install\` in ${label(clientRoot)} so its pairing with ${pair.crate} can be checked`,
    );
    continue;
  }

  const crateVersion = crateVersions[0];
  checked++;
  const npmRelease = majorMinor(npmVersion);
  const crateRelease = majorMinor(crateVersion);
  if (npmRelease === crateRelease) continue;

  errors.push(
    `${pair.npm} ${npmVersion} and ${pair.crate} ${crateVersion} are on different releases ` +
      `(${npmRelease} vs ${crateRelease}); update whichever side is behind, in package.json or ` +
      `${lockLabel}, so both share a major/minor`,
  );
}

// ---- Zero-floor guard ----
// A pair is skipped when its crate is absent from Cargo.lock, so a lockfile or
// manifest edit can leave zero comparable pairs and still print "0 package(s)
// share a major/minor" as a pass. Declared Tauri packages with nothing to
// compare is a broken pairing check, not a clean one.
if (checked === 0) {
  errors.push(
    `no Tauri npm/crate pair could be compared — ${pairs.length} Tauri npm package(s) are ` +
      `declared, but none resolved to a crate in ${lockLabel}. A lockfile rename or a ` +
      'missing install must not turn this gate into a vacuous pass',
  );
}

if (errors.length > 0) {
  console.error(`✗ Tauri npm/crate version check failed (${errors.length} issue(s)):\n`);
  for (const error of errors) console.error(`  - ${error}`);
  console.error(
    '\n`tauri dev` and `tauri build` read these same two sources and refuse to start on a mismatch.',
  );
  process.exit(1);
}

console.log(
  `✓ Tauri npm/crate versions aligned — ${checked} package(s) share a major/minor with ${lockLabel}`,
);
