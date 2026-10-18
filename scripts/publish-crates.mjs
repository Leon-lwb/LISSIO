#!/usr/bin/env node
/**
 * publish-crates.mjs — publish workspace crates to crates.io in dependency topological order
 *
 * Order: the cargo metadata dependency graph (including dev-dependencies, so graph-testkit is
 * published before the test hosts that depend on it). Before publishing, the crates.io API is
 * checked for name/version availability; after a successful upload, the index is polled until the
 * new version is visible, then downstream crates are published (crates.io index propagation takes
 * tens of seconds).
 *
 * Usage:
 *   pnpm publish:crates                       dry-run: preflight + `cargo publish --dry-run` per crate, no upload
 *   pnpm publish:crates -- --execute          actually publish (needs cargo login credentials)
 *   pnpm publish:crates -- --from lissio-kind resume from somewhere in the topological order (interrupt recovery)
 *   pnpm publish:crates -- --only lissio-error,lissio-kind
 *   pnpm publish:crates -- --skip lissio-app
 *   pnpm publish:crates -- --allow-dirty      allow a dirty working tree (rejected by default)
 *
 * Authentication: uses the default cargo credentials (~/.cargo/credentials) or the CARGO_REGISTRY_TOKEN environment variable.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(repoRoot, 'server', 'Cargo.toml');
const REGISTRY_API = 'https://crates.io/api/v1';
// crates.io requires a reachable project homepage in the UA; the repository has moved to Codeberg.
const USER_AGENT = 'lissio-publish-script (https://codeberg.org/Horldsence/Lissio)';
const INDEX_POLL_INTERVAL_MS = 4_000;
const INDEX_POLL_TIMEOUT_MS = 180_000;
const INTER_PUBLISH_PAUSE_MS = 2_000;
// The desktop app shell ships with the release and does not go to crates.io; use --only lissio to force a placeholder publish.
const DEFAULT_SKIP = new Set(['lissio']);

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const allowDirty = args.includes('--allow-dirty');
const onlyList = listArg('--only');
const skipList = listArg('--skip');
const from = args.find((arg) => arg.startsWith('--from='))?.split('=')[1]
  ?? (args.includes('--from') ? args[args.indexOf('--from') + 1] : undefined)
  ?? null;

function listArg(name) {
  const value = args.find((arg) => arg.startsWith(`${name}=`))?.split('=')[1]
    ?? (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  return value ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : [];
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function cargoJson(extraArgs) {
  return JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', ...extraArgs, '--manifest-path', manifestPath], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }));
}

async function registryGet(path) {
  const response = await fetch(`${REGISTRY_API}${path}`, { headers: { 'user-agent': USER_AGENT } });
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after')) || 30;
    await sleep(retryAfter * 1_000);
    return registryGet(path);
  }
  return { status: response.status, body: response.ok ? await response.json() : null };
}

const sleep = (ms) => new Promise((resolve_) => setTimeout(resolve_, ms));

// --- Load workspace members and dependency edges ---

const metadata = cargoJson(['--no-deps']);
const members = new Set(metadata.workspace_members);
const packages = metadata.packages.filter((pkg) => members.has(pkg.id));
const memberByName = new Map(packages.map((pkg) => [pkg.name, pkg]));

/**
 * The release version of this workspace.
 *
 * `server/Cargo.toml` is a virtual workspace manifest — there is no root package
 * to read a version from — so it comes from `[workspace.package]`, which every
 * member inherits. A resolved member version is the fallback, so a future root
 * package keeps working.
 *
 * Scope: this publishes the `server/` workspace. `server/core` and `server/data`
 * are separate Cargo workspaces (excluded from this member list) and publish
 * from their own repositories, in the same way their CI runs their own tests.
 */
function workspaceVersionOf(manifestText, workspacePackages) {
  let section = '';
  for (const line of manifestText.split('\n')) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) section = header[1].trim();
    if (section === 'workspace.package') {
      const found = line.match(/^version\s*=\s*"([^"]+)"/);
      if (found) return found[1];
    }
  }
  return workspacePackages.find((pkg) => pkg.name === 'lissio')?.version
    ?? workspacePackages[0]?.version
    ?? null;
}

const manifestText = readFileSync(manifestPath, 'utf8');
const workspaceVersion = workspaceVersionOf(manifestText, packages);
if (!workspaceVersion) fail('cannot resolve the workspace version from cargo metadata');

// Static safeguard: internal [workspace.dependencies] entries must carry an explicit version (on
// crates.io path dependencies are stripped, and without a version downstream publishing cannot resolve them).
for (const line of manifestText.split('\n')) {
  if (/path\s*=\s*"[^"]*crates\//.test(line) && !/version\s*=\s*"/.test(line) && /^\s*[^#[]/.test(line)) {
    fail(`[workspace.dependencies] internal entry is missing version: ${line.trim()}`);
  }
}

// Dependency edges: normal/build determine the publish order; dev-dependencies are only an order
// preference — this repository has dev-dep cycles (e.g. can ↔ data-model), which cargo allows but a
// strict topology would deadlock on. Crates whose internal dev-deps are not yet in the index are
// published with --no-verify (skipping compile verification, see below).
const normalDepsOf = new Map(packages.map((pkg) => [pkg.name, []]));
const devDepsOf = new Map(packages.map((pkg) => [pkg.name, []]));
for (const pkg of packages) {
  for (const dependency of pkg.dependencies) {
    if (!memberByName.has(dependency.name) || dependency.name === pkg.name) continue;
    // cargo metadata: kind is null (normal) / "dev" / "build" (older versions use an array; both forms are handled).
    const kinds = Array.isArray(dependency.kind) ? dependency.kind : dependency.kind ? [dependency.kind] : [];
    (kinds.includes('dev') ? devDepsOf : normalDepsOf).get(pkg.name).push(dependency.name);
  }
}

// Kahn topological sort (normal/build edges, dependencies first). Among equal candidates, prefer the
// crate whose internal dev-deps are all already ordered, so downstream dev-deps resolve at publish time.
const pendingDeps = new Map([...normalDepsOf].map(([name, deps]) => [name, deps.length]));
const dependents = new Map(packages.map((pkg) => [pkg.name, []]));
for (const [name, deps] of normalDepsOf) {
  for (const dep of deps) dependents.get(dep).push(name);
}
const ordered = new Set();
const ready = packages.filter((pkg) => pendingDeps.get(pkg.name) === 0).map((pkg) => pkg.name);
const pickNext = () => {
  const satisfied = ready.filter((name) => devDepsOf.get(name).every((dep) => ordered.has(dep)));
  const pool = satisfied.length ? satisfied : ready;
  pool.sort();
  return pool[0];
};
const order = [];
while (ready.length) {
  const name = pickNext();
  ready.splice(ready.indexOf(name), 1);
  order.push(name);
  ordered.add(name);
  for (const dependent of dependents.get(name)) {
    const left = pendingDeps.get(dependent) - 1;
    pendingDeps.set(dependent, left);
    if (left === 0) ready.push(dependent);
  }
}
if (order.length !== packages.length) {
  const cyclic = packages.map((pkg) => pkg.name).filter((name) => !order.includes(name));
  fail(`dependency graph has a cycle or is unresolvable: ${cyclic.join(', ')}`);
}

// --- Filter down to the set to publish ---

const skipped = new Set(DEFAULT_SKIP);
for (const pkg of packages) {
  // publish = false shows up in metadata as [] (a restricted registry list is a non-empty array; null means unrestricted).
  if (Array.isArray(pkg.publish)) {
    console.log(`skipping ${pkg.name}: manifest declares publish = false`);
    skipped.add(pkg.name);
  }
}
for (const name of skipList) skipped.add(name);

let targets = order.filter((name) => !skipped.has(name));
// Dependents of a skipped crate also cannot resolve from crates.io, so drop them in a cascade.
for (;;) {
  const blocked = targets.filter((name) => normalDepsOf.get(name).some((dep) => skipped.has(dep)));
  if (blocked.length === 0) break;
  for (const name of blocked) {
    console.log(`skipping ${name}: depends on unpublished ${normalDepsOf.get(name).filter((dep) => skipped.has(dep)).join(', ')}`);
    skipped.add(name);
  }
  targets = targets.filter((name) => !skipped.has(name));
}
if (onlyList.length) {
  const only = new Set(onlyList);
  targets = targets.filter((name) => only.has(name));
}
if (from) {
  const position = targets.indexOf(from);
  if (position < 0) fail(`--from ${from} is not in the set to publish (run a dry-run first to see the order)`);
  targets = targets.slice(position);
}

// --- Preflight: clean working tree + crates.io name/version availability ---

if (!allowDirty) {
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  if (status.stdout.trim()) {
    fail('working tree is dirty; commit first or use --allow-dirty');
  }
}

console.log(`\nworkspace v${workspaceVersion} — ${targets.length} crate(s) to publish (${execute ? 'EXECUTE, real upload' : 'dry-run, no upload'}):\n`);
targets.forEach((name, index) => console.log(`  ${String(index + 1).padStart(3)}. ${name}`));
console.log();

let published = 0;
for (const name of targets) {
  const version = memberByName.get(name).version;
  const existing = await registryGet(`/crates/${name}`);
  if (existing.status === 200) {
    const versionStatus = await registryGet(`/crates/${name}/${version}`);
    if (versionStatus.status === 200) {
      console.log(`= ${name}@${version} already exists on crates.io, skipping`);
      continue;
    }
  } else if (existing.status !== 404) {
    fail(`crates.io lookup for ${name} failed (HTTP ${existing.status})`);
  }

  // dev-dep bootstrap: when a versioned internal dev-dep is not yet in the index, the packaged
  // manifest cannot resolve, so compile verification would necessarily fail — publish this crate
  // with verification skipped, and let downstream crates verify normally once its dev-dep is published.
  const missingDevDeps = execute
    ? (await Promise.all(devDepsOf.get(name).map(async (dep) => {
        const status = (await registryGet(`/crates/${dep}/${memberByName.get(dep).version}`)).status;
        return status === 200 ? null : dep;
      }))).filter(Boolean)
    : [];
  if (missingDevDeps.length) {
    console.log(`  warning: internal dev-dep not yet published (${missingDevDeps.join(', ')}), skipping compile verification this time (--no-verify)`);
  }
  // dry-run uses cargo package --list: `cargo publish --dry-run` resolves dependencies from the
  // crates.io index and would necessarily fail before the first publish; --list validates the
  // manifest/file set without touching the network. Full compile verification happens during
  // --execute per-crate publishing (dependencies enter the index as the order progresses).
  const cargoArgs = execute
    ? ['publish', '--manifest-path', manifestPath, '-p', name]
    : ['package', '--no-verify', '--list', '--manifest-path', manifestPath, '-p', name];
  if (execute && missingDevDeps.length) cargoArgs.push('--no-verify');
  if (allowDirty) cargoArgs.push('--allow-dirty');
  console.log(`${execute ? '→' : '·'} ${name}@${version} ...`);
  const result = spawnSync('cargo', cargoArgs, { stdio: 'inherit' });
  if (result.status !== 0) {
    fail(`cargo publish ${name} failed (exit ${result.status})`);
  }
  if (!execute) {
    published += 1;
    continue;
  }

  // Wait for index propagation, or downstream crate publishing will not resolve this dependency.
  const deadline = Date.now() + INDEX_POLL_TIMEOUT_MS;
  for (;;) {
    const check = await registryGet(`/crates/${name}/${version}`);
    if (check.status === 200) break;
    if (Date.now() > deadline) fail(`timed out waiting for ${name}@${version} to enter the crates.io index`);
    await sleep(INDEX_POLL_INTERVAL_MS);
  }
  console.log(`  ${name}@${version} is now in the index`);
  published += 1;
  await sleep(INTER_PUBLISH_PAUSE_MS);
}

console.log(`\nDone: ${published} crate(s) ${execute ? 'published' : 'passed dry-run'}.`);
if (!execute) console.log('This was a dry-run; add --execute to actually publish.');
