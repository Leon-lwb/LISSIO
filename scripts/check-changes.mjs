#!/usr/bin/env node
/**
 * check-changes.mjs — validity gate for `.changes` change files and configuration.
 *
 * Why it exists: covector's failure mode for a change file is to **silently drop** it. An
 * entry with a misspelled package name does not error; the change just vanishes silently
 * from the next release notes, and the same goes for a wrong bump type or tag. This gate
 * moves those failures from "discovered on release day" to the PR stage, and it only reads
 * files, so it does not depend on a diff base.
 *
 * What it checks:
 *   - config.json: top-level keys are valid (matching covector's .strict() mode), package
 *     paths and manifests exist, and each manager is defined and able to write versions;
 *   - .changes/*.md: frontmatter parses, the package name is declared, the bump type is
 *     valid, the tag is declared, the summary is non-empty, and the same package is not
 *     declared twice in one file;
 *   - pre.json: the structure is valid, the tag is non-empty, and the files named in the
 *     changes array actually exist.
 *
 * Usage:
 *   pnpm check:changes
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const changesDir = join(repoRoot, '.changes');
const rel = (path) => relative(repoRoot, path).split(/[\\/]/).join('/');

const errors = [];
const fail = (message) => errors.push(message);

// covector's configFileSchema is .strict(): an unknown top-level key throws. This keeps the
// same list so a config typo is caught at the PR stage instead of on release day.
const CONFIG_KEYS = new Set([
  'changeFolder',
  'gitSiteUrl',
  'timeout',
  'additionalBumpTypes',
  'defaultChangeTag',
  'pkgManagers',
  'packages',
  'changeTags',
]);
const BASE_BUMPS = ['major', 'minor', 'patch', 'noop'];
const README_RE = /^readme\.md$/i;
const KEBAB_RE = /^[a-z][a-z0-9-]*$/;

/** covector's manager → manifest inference rule (`@covector/files` readPkgFile). */
function manifestName(manager, packageFileName) {
  if (packageFileName) return packageFileName;
  if (/rust/.test(manager)) return 'Cargo.toml';
  if (/dart|flutter/.test(manager)) return 'pubspec.yaml';
  return 'package.json';
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${rel(path)}: not valid JSON — ${error.message}`);
    return null;
  }
}

// ── .changes and config.json ────────────────────────────────────────────────
if (!existsSync(changesDir) || !statSync(changesDir).isDirectory()) {
  fail('.changes/ directory is missing; version policy and change files live here');
}

const configPath = join(changesDir, 'config.json');
const config = existsSync(configPath) ? readJson(configPath) : null;
if (!config) {
  if (!existsSync(configPath)) fail('.changes/config.json is missing');
  console.error(errors.map((message) => `✗ ${message}`).join('\n'));
  process.exit(1);
}

for (const key of Object.keys(config)) {
  if (!CONFIG_KEYS.has(key)) {
    fail(`.changes/config.json: unknown top-level key "${key}" — covector's config is strict, so this key makes every command fail`);
  }
}

const packages = config.packages;
const pkgManagers = config.pkgManagers ?? {};
const changeTags = config.changeTags ?? {};
const additionalBumps = config.additionalBumpTypes ?? [];

if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
  fail('.changes/config.json: packages must be an object');
} else if (Object.keys(packages).length === 0) {
  fail('.changes/config.json: packages must not be empty');
}

for (const [name, entry] of Object.entries(packages ?? {})) {
  if (!entry || typeof entry !== 'object') {
    fail(`.changes/config.json: package "${name}" must be an object`);
    continue;
  }
  const dir = resolve(repoRoot, entry.path ?? '');
  if (typeof entry.path !== 'string' || !entry.path) {
    fail(`.changes/config.json: package "${name}" is missing path`);
  } else if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(`.changes/config.json: package "${name}" path does not exist — ${entry.path}`);
  } else {
    const manifest = join(dir, manifestName(entry.manager ?? '', entry.packageFileName));
    if (!existsSync(manifest)) {
      fail(`.changes/config.json: package "${name}" has no manifest — ${rel(manifest)}`);
    }
  }

  const manager = pkgManagers[entry.manager];
  if (typeof entry.manager !== 'string' || !entry.manager) {
    fail(`.changes/config.json: package "${name}" is missing manager; without a manager, no version is written`);
  } else if (!manager) {
    fail(
      `.changes/config.json: package "${name}" manager "${entry.manager}" is not defined in pkgManagers — ` +
        'version writing is silently skipped',
    );
  } else if (manager.version !== true && entry.version === undefined) {
    fail(
      `.changes/config.json: package "${name}" does not enable version writing — pkgManagers.${entry.manager}.version ` +
        'is not true, and the package has no custom version command',
    );
  }
}

for (const [tag, heading] of Object.entries(changeTags)) {
  if (!KEBAB_RE.test(tag)) fail(`.changes/config.json: changeTags key "${tag}" is not kebab-case`);
  if (typeof heading !== 'string' || !heading) {
    fail(`.changes/config.json: changeTags["${tag}"] must be a section heading string`);
  }
}
if (config.defaultChangeTag !== undefined && !(config.defaultChangeTag in changeTags)) {
  fail(
    `.changes/config.json: defaultChangeTag "${config.defaultChangeTag}" is not in changeTags`,
  );
}

// ── Change files ───────────────────────────────────────────────────────────────
const ALLOWED_BUMPS = new Set([...BASE_BUMPS, ...additionalBumps]);
const changeFiles = existsSync(changesDir)
  ? readdirSync(changesDir)
      .filter((name) => name.endsWith('.md') && !README_RE.test(name))
      .sort()
  : [];

const RELEASE_LINE = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9@/._-]+))\s*:\s*([a-z]+)\s*(?::\s*([a-z][a-z0-9-]*))?\s*$/;

for (const name of changeFiles) {
  const path = join(changesDir, name);
  const label = rel(path);
  const text = readFileSync(path, 'utf8');

  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!front) {
    fail(`${label}: missing --- delimited frontmatter`);
    continue;
  }
  const body = text.slice(front[0].length).trim();
  if (!body) fail(`${label}: no summary body after the frontmatter`);

  const seen = new Set();
  let releases = 0;
  for (const rawLine of front[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(RELEASE_LINE);
    if (!match) {
      fail(`${label}: cannot parse frontmatter line "${line}" (expected "<package>": <bump>[:<tag>])`);
      continue;
    }
    const pkg = match[1] ?? match[2] ?? match[3];
    const bump = match[4];
    const tag = match[5];

    if (seen.has(pkg)) fail(`${label}: package "${pkg}" is declared twice`);
    seen.add(pkg);
    releases += 1;

    if (!packages || !(pkg in packages)) {
      fail(
        `${label}: package "${pkg}" is not in config.json packages — covector silently drops this change`,
      );
    }
    if (!ALLOWED_BUMPS.has(bump)) {
      fail(`${label}: bump type "${bump}" is invalid (allowed: ${[...ALLOWED_BUMPS].join(' / ')})`);
    }
    if (tag && !(tag in changeTags)) {
      fail(`${label}: tag "${tag}" is not declared in config.json changeTags`);
    }
  }
  if (releases === 0) fail(`${label}: frontmatter declares no packages`);
}

// ── Prerelease mode ─────────────────────────────────────────────────────────────
const prePath = join(changesDir, 'pre.json');
if (existsSync(prePath)) {
  const pre = readJson(prePath);
  if (pre) {
    if (typeof pre.tag !== 'string' || !pre.tag) {
      fail('.changes/pre.json: tag must be a non-empty string (for example "beta")');
    } else if (!/^[a-z][a-z0-9.-]*$/.test(pre.tag)) {
      fail(`.changes/pre.json: tag "${pre.tag}" may contain only lowercase letters, digits, dots, and hyphens`);
    }
    if (!Array.isArray(pre.changes)) {
      fail('.changes/pre.json: changes must be an array');
    } else {
      for (const entry of pre.changes) {
        if (typeof entry !== 'string') {
          fail(`.changes/pre.json: changes entries must be path strings, got ${JSON.stringify(entry)}`);
        } else if (!existsSync(resolve(repoRoot, entry))) {
          fail(`.changes/pre.json: a file named by changes does not exist — ${entry}`);
        }
      }
    }
  }
}

// ── Result ───────────────────────────────────────────────────────────────────
if (errors.length > 0) {
  console.error('Change file gate failed:');
  for (const message of errors) console.error(`  ✗ ${message}`);
  process.exit(1);
}

const pre = existsSync(prePath) ? ', prerelease mode enabled' : '';
console.log(
  `✓ Change file gate passed — ${changeFiles.length} change files, ` +
    `${Object.keys(packages ?? {}).length} packages, ${Object.keys(changeTags).length} changelog sections${pre}`,
);
