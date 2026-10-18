#!/usr/bin/env node
/**
 * check-release-sync.mjs — release sync gate: the version number and the
 * CHANGELOG must agree.
 *
 * Why it exists: the release path has many independent version locations spread
 * across the submodules, and missing any one produces an artifact whose filename
 * lies. MSI rejects prerelease identifiers, so `tauri.conf.json` and the Cargo
 * side may only carry the base version while the npm manifests keep the full
 * semver; a stale `Cargo.lock` breaks `--locked` builds outright; a CHANGELOG one
 * version behind shows users the wrong release notes.
 *
 * What it checks:
 *   1. the umbrella `package.json`, `client/package.json`,
 *      `client/src-tauri/tauri.conf.json`, one root manifest per Cargo workspace
 *      (`server/`, `server/core/`, `server/data/`, `client/src-tauri/` — the
 *      version sits in `[package]` or, for a virtual workspace manifest, in
 *      `[workspace.package]`, plus the internal `[workspace.dependencies]` pins),
 *      and the lockfile each of those workspaces resolves through agree on one
 *      version;
 *   2. the CHANGELOG.md metadata block sits above the entries, the newest entry
 *      carries the right version and date, and versions strictly decrease
 *      without duplicates.
 *
 * It is a PR-tier gate, so the release.yml preflight covers it automatically.
 *
 * Usage:
 *   pnpm check:release-sync
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (message) => errors.push(message);

const read = (path) => readFileSync(path, 'utf8');
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** semver comparison; negative / 0 / positive. A release outranks its prereleases. */
function compareVersions(a, b) {
  const parse = (value) => {
    const match = value.match(VERSION_RE);
    if (!match) return null;
    return {
      nums: [Number(match[1]), Number(match[2]), Number(match[3])],
      pre: match[4] ? match[4].split('.') : null,
    };
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left.nums[i] !== right.nums[i]) return left.nums[i] - right.nums[i];
  }
  if (!left.pre && !right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  const length = Math.max(left.pre.length, right.pre.length);
  for (let i = 0; i < length; i += 1) {
    const l = left.pre[i];
    const r = right.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    if (lNum && rNum) return Number(l) - Number(r);
    if (lNum) return -1;
    if (rNum) return 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

// ── 1. Version source of truth ─────────────────────────────────────────────
const pkgPath = join(repoRoot, 'package.json');
if (!existsSync(pkgPath)) {
  console.error('package.json is missing');
  process.exit(1);
}
const version = JSON.parse(read(pkgPath)).version;
if (typeof version !== 'string' || !VERSION_RE.test(version)) {
  console.error(`package.json version "${version}" is not valid semver`);
  process.exit(1);
}
const base = version.split('-')[0];

/**
 * Every file that carries the release version, and the repository it lives in.
 *
 * `package.json` keeps the full semver; every other file carries the base
 * version, because MSI rejects prerelease identifiers. Each Cargo workspace has
 * its own manifest and lockfile now — `server/` is a virtual workspace manifest
 * (the version sits in `[workspace.package]`), `core/` and `data/` are
 * workspaces of their own, and the Tauri shell is a root package with a path
 * dependency on the services it embeds. A manifest that is not checked out is
 * skipped, but at least one must be present.
 */
const RUST_MANIFESTS = [
  ['server', 'Cargo.toml'],
  ['server', 'core', 'Cargo.toml'],
  ['server', 'data', 'Cargo.toml'],
  ['client', 'src-tauri', 'Cargo.toml'],
];
const RUST_LOCKFILES = [
  ['server', 'Cargo.lock'],
  ['server', 'core', 'Cargo.lock'],
  ['server', 'data', 'Cargo.lock'],
  ['client', 'src-tauri', 'Cargo.lock'],
];

// ── 2. client/package.json ─────────────────────────────────────────────────
const frontendPkgPath = join(repoRoot, 'client', 'package.json');
if (!existsSync(frontendPkgPath)) {
  fail('client/package.json is missing');
} else {
  const frontendVersion = JSON.parse(read(frontendPkgPath)).version;
  if (frontendVersion !== version) {
    fail(
      `client/package.json is ${frontendVersion} while the umbrella package.json is ${version} — ` +
        'both manifests carry the release version and must agree',
    );
  }
}

// ── 3. tauri.conf.json ─────────────────────────────────────────────────────
const tauriPath = join(repoRoot, 'client', 'src-tauri', 'tauri.conf.json');
if (!existsSync(tauriPath)) {
  fail('client/src-tauri/tauri.conf.json is missing');
} else {
  const tauriVersion = JSON.parse(read(tauriPath)).version;
  if (tauriVersion !== base) {
    fail(
      `client/src-tauri/tauri.conf.json is ${tauriVersion}, expected the base version ${base} (MSI rejects prereleases)`,
    );
  }
}

// ── 4. Cargo manifests: one root manifest per workspace ───────────────────
let manifestsChecked = 0;
for (const parts of RUST_MANIFESTS) {
  const label = parts.join('/');
  const manifest = join(repoRoot, ...parts);
  if (!existsSync(manifest)) continue;
  manifestsChecked += 1;
  let section = '';
  const seen = { package: false, 'workspace.package': false };
  for (const line of read(manifest).split('\n')) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header) section = header[1].trim();
    if ((section === 'package' || section === 'workspace.package') && /^version\s*=\s*"/.test(line)) {
      seen[section] = true;
      const found = line.match(/^version\s*=\s*"([^"]+)"/)[1];
      if (found !== base) {
        fail(`${label} [${section}] is ${found}, expected ${base}`);
      }
    }
    if (
      section === 'workspace.dependencies' &&
      /path\s*=\s*"[^"]*crates\//.test(line) &&
      /version\s*=\s*"/.test(line)
    ) {
      const found = line.match(/version\s*=\s*"([^"]+)"/)[1];
      if (found !== base) {
        fail(`${label} [workspace.dependencies] pins an internal dependency at ${found}, expected ${base}`);
      }
    }
  }
  // A workspace root states the version either as a package or for its members;
  // a manifest with neither is a member manifest pointed at by mistake, and
  // would silently exempt the workspace it names.
  if (!seen.package && !seen['workspace.package']) {
    fail(`${label} declares no version in [package] or [workspace.package]`);
  }
}
if (manifestsChecked === 0) {
  fail('no Rust manifest was found — the server and client submodules are not checked out');
}

// ── 5. Cargo.lock: every workspace that resolves lissio packages ──────────
let lockfilesChecked = 0;
let lockedPackages = 0;
for (const parts of RUST_LOCKFILES) {
  const label = parts.join('/');
  const lockPath = join(repoRoot, ...parts);
  if (!existsSync(lockPath)) continue;
  lockfilesChecked += 1;
  let name = null;
  let found = null;
  let source = null;
  const flush = () => {
    // A registry or git source is a published copy, not the workspace member:
    // its version is pinned by the dependency requirement, not by this release.
    if (name && source === null && /^lissio(-|$)/.test(name)) {
      lockedPackages += 1;
      if (found !== base) {
        fail(`${label} has ${name} at ${found}, expected ${base}; re-run pnpm set-version`);
      }
    }
    name = null;
    found = null;
    source = null;
  };
  for (const line of read(lockPath).split('\n')) {
    if (line.trim() === '[[package]]') {
      flush();
      continue;
    }
    const nameMatch = line.match(/^name\s*=\s*"([^"]+)"/);
    if (nameMatch) name = nameMatch[1];
    const versionMatch = line.match(/^version\s*=\s*"([^"]+)"/);
    if (versionMatch) found = versionMatch[1];
    const sourceMatch = line.match(/^source\s*=\s*"([^"]+)"/);
    if (sourceMatch) source = sourceMatch[1];
  }
  flush();
}
if (lockfilesChecked === 0) fail('no Cargo.lock was found — the workspace lockfiles are not checked out');
if (lockedPackages === 0) fail('no lockfile records a local lissio package entry');

// ── 5. CHANGELOG.md ───────────────────────────────────────────────────────
const changelogPath = join(repoRoot, 'CHANGELOG.md');

/** Parse a CHANGELOG: metadata position, entry version order, and each entry heading. */
function parseChangelog(path, label) {
  if (!existsSync(path)) {
    fail(`${label} is missing`);
    return null;
  }
  const text = read(path);
  const metaAt = text.search(/<!--\s*lissio-doc\b/);
  if (metaAt === -1) fail(`${label} is missing its <!-- lissio-doc --> metadata block`);

  const entries = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^## \[([^\]]+)\]/);
    if (match) entries.push({ version: match[1], line });
  }
  if (entries.length === 0) fail(`${label} has no "## [x.y.z]" entry`);

  const firstAt = text.search(/^## \[/m);
  if (metaAt !== -1 && firstAt !== -1 && metaAt > firstAt) {
    fail(
      `${label}: the lissio-doc metadata block sits below the first entry — run pnpm exec node scripts/changelog-normalize.mjs`,
    );
  }
  return entries;
}

const enEntries = parseChangelog(changelogPath, 'CHANGELOG.md');
if (enEntries) {
  const [latest] = enEntries;
  if (latest.version !== version) {
    fail(`CHANGELOG.md's newest entry is ${latest.version} while package.json is ${version} — the release notes lag the version`);
  }
  if (!/^## \[[^\]]+\]\s+-\s+\d{4}-\d{2}-\d{2}/.test(latest.line)) {
    fail(`CHANGELOG.md's newest entry has no release date: ${latest.line.trim()}`);
  }
  const versions = enEntries.map((entry) => entry.version);
  const duplicates = versions.filter((value, index) => versions.indexOf(value) !== index);
  if (duplicates.length > 0) {
    fail(`CHANGELOG.md has duplicate entries: ${[...new Set(duplicates)].join(', ')}`);
  }
  for (let i = 1; i < versions.length; i += 1) {
    if (compareVersions(versions[i - 1], versions[i]) <= 0) {
      fail(`CHANGELOG.md entries are not strictly decreasing: ${versions[i - 1]} is followed by ${versions[i]}`);
    }
  }
}

// ── Result ─────────────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error('Release sync gate failed:');
  for (const message of errors) console.error(`  ✗ ${message}`);
  process.exit(1);
}

console.log(
  `✓ Release sync gate passed — v${version} (base ${base}) agrees across package.json, client/package.json, ` +
    `${manifestsChecked} Cargo manifest(s) and ${lockfilesChecked} lockfile(s), and CHANGELOG.md carries it`,
);
