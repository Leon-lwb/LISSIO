#!/usr/bin/env node
// Device contract freeze — the interface, wire, profile, and runtime types every
// remaining device-abstraction lane depends on must not drift silently.
//
// `docs/architecture/device-contracts.lock.json` records the SHA-256 of each
// frozen file, and this script holds the freeze list that the manifest must
// match. The list lives here rather than only in the manifest because a
// manifest that is its own source of truth can lose a file by deleting its row.
//
// Editing a frozen file without refreshing the manifest fails the gate.
// Refreshing it requires `--update --message "contract: <what changed>"`, so a
// field change cannot land as an ordinary edit: the refresh is a contract commit
// that dependent lanes rebase onto after the `device-contracts-vN` tag moves.
//
// The script never stages, commits, or tags. It reads the frozen files and, on
// an explicit update, writes the manifest.
//
// Usage:
//   node scripts/check-device-contracts.mjs [--check] [--root=<path>]
//   node scripts/check-device-contracts.mjs --update --message "contract: <what changed>" [--root=<path>]
//
// `--root` selects another checkout for tests and defaults to the repository
// that contains this script. The parser is local on purpose: this gate is
// cross-repository (`server/core`, `server/physical`, and a future
// `client/src/types/generated`), so it cannot use `scripts/repo-root.mjs`,
// whose contract says cross-repository gates use explicit paths.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONTRACT_TAG = 'device-contracts-v1';
export const MANIFEST_VERSION = 1;
export const MANIFEST_PATH = 'docs/architecture/device-contracts.lock.json';

/**
 * Allowed reach of the freeze, as umbrella-relative prefixes. This is a scope
 * guard, not a discovery glob: a path passes when it equals a root or starts
 * with `root + '/'`. `server/core` and `server/physical` are inside `server`;
 * all four entries stay so the manifest documents the intended cross-repository
 * reach, including generated TypeScript a later contract version may freeze.
 */
export const SCOPE_ROOTS = [
  'server/core',
  'server/physical',
  'server',
  'client/src/types/generated',
];

/** The v1 freeze list, in manifest order. Owners change only by contract update. */
export const CONTRACT_FILES = [
  { path: 'server/core/crates/shared/data-model/src/ids.rs', owner: 'W0a' },
  { path: 'server/core/crates/shared/data-model/src/interface.rs', owner: 'W0a' },
  { path: 'server/core/crates/shared/data-model/src/structured.rs', owner: 'W0a' },
  { path: 'server/core/crates/shared/wire/src/lib.rs', owner: 'W0a' },
  { path: 'server/core/crates/shared/wire/src/schema.rs', owner: 'W0a' },
  { path: 'server/core/crates/shared/wire/src/value.rs', owner: 'W0a' },
  { path: 'server/core/crates/shared/wire/src/path.rs', owner: 'W0a' },
  { path: 'server/core/crates/shared/wire/src/codec.rs', owner: 'W0a' },
  { path: 'server/core/crates/shared/wire/src/registry.rs', owner: 'W0a' },
  { path: 'server/core/crates/shared/wire/src/limits.rs', owner: 'W0a' },
  { path: 'server/core/crates/shared/wire/src/error.rs', owner: 'W0a' },
  { path: 'server/core/crates/protocol/protocol/src/config.rs', owner: 'W0a' },
  { path: 'server/core/crates/protocol/protocol/src/context.rs', owner: 'W0a' },
  { path: 'server/core/crates/protocol/protocol/src/error.rs', owner: 'W0a' },
  { path: 'server/core/crates/protocol/protocol/src/frame.rs', owner: 'W0a' },
  { path: 'server/core/crates/protocol/protocol/src/output.rs', owner: 'W0a' },
  { path: 'server/core/crates/protocol/protocol/src/profile.rs', owner: 'W0a' },
  { path: 'server/core/crates/protocol/protocol/src/registry.rs', owner: 'W0a' },
  { path: 'server/core/crates/protocol/protocol/src/traits.rs', owner: 'W0a' },
  { path: 'server/physical/crates/protocol/acquisition/src/interface.rs', owner: 'W0a' },
  { path: 'server/physical/crates/transport/device-tree/src/driver.rs', owner: 'W0a' },
];

const SHA256_HEX = /^[0-9a-f]{64}$/;

const USAGE =
  'usage: node scripts/check-device-contracts.mjs [--check] ' +
  '[--update --message "contract: <what changed>"] [--root=<path>]';

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

/** True when `path` equals a scope root or sits below one. */
function inScope(path) {
  return SCOPE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

/** SHA-256 hex of one frozen file. A missing file is drift, not a crash. */
export function hashFile(root, relativePath) {
  const absolute = join(root, relativePath);
  if (!existsSync(absolute)) {
    throw new Error(`device contract file is missing: ${relativePath} (looked under ${root})`);
  }
  return createHash('sha256').update(readFileSync(absolute)).digest('hex');
}

/** The manifest `--update` writes: fresh hashes, freeze-list order, no merge. */
export function buildManifest(root, files = CONTRACT_FILES) {
  return {
    version: MANIFEST_VERSION,
    tag: CONTRACT_TAG,
    files: files.map(({ path, owner }) => ({
      path,
      sha256: hashFile(root, path),
      owner,
    })),
  };
}

/**
 * Every problem with `manifest` as a v1 freeze record, in report order.
 *
 * `string[]`, each entry `<path>: <reason>`, so the CLI can print one
 * `  - <problem>` line per finding. Never throws for a well-formed argument;
 * missing or unparseable JSON is the CLI's concern.
 */
export function checkManifest(root, manifest, files = CONTRACT_FILES) {
  const problems = [];
  const label = MANIFEST_PATH;

  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return [`${label}: manifest is not a JSON object`];
  }
  if (manifest.version !== MANIFEST_VERSION) {
    problems.push(
      `${label}: version is ${JSON.stringify(manifest.version)}, expected ${MANIFEST_VERSION}`,
    );
  }
  if (manifest.tag !== CONTRACT_TAG) {
    problems.push(`${label}: tag is ${JSON.stringify(manifest.tag)}, expected "${CONTRACT_TAG}"`);
  }
  if (!Array.isArray(manifest.files)) {
    problems.push(`${label}: "files" is not an array`);
    return problems;
  }

  const expected = new Map(files.map(({ path, owner }) => [path, owner]));
  const rows = new Map();
  manifest.files.forEach((row, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      problems.push(`${label}: files[${index}]: entry is not an object`);
      return;
    }
    const pathValid = isNonEmptyString(row.path);
    // Name the frozen path, not the position, once the row has one: the reader
    // needs the file, and `<path>: <reason>` is this gate's report shape.
    const rowLabel = pathValid ? row.path : `${label}: files[${index}]`;
    const shaValid = isNonEmptyString(row.sha256) && SHA256_HEX.test(row.sha256);
    const ownerValid = isNonEmptyString(row.owner);
    if (!pathValid) problems.push(`${rowLabel}: path is missing or not a non-empty string`);
    if (!isNonEmptyString(row.sha256)) {
      problems.push(`${rowLabel}: sha256 is missing or not a non-empty string`);
    } else if (!shaValid) {
      problems.push(
        `${rowLabel}: sha256 "${row.sha256}" is not 64 lowercase hexadecimal characters`,
      );
    }
    if (!ownerValid) problems.push(`${rowLabel}: owner is missing or not a non-empty string`);
    if (!pathValid) return;

    if (rows.has(row.path)) {
      problems.push(`${row.path}: duplicate manifest row`);
    } else {
      rows.set(row.path, { row, shaValid, ownerValid });
    }
    if (!inScope(row.path)) {
      problems.push(
        `${row.path}: outside the frozen contract scope (${SCOPE_ROOTS.join(', ')})`,
      );
    }
  });

  for (const { path, owner } of files) {
    const entry = rows.get(path);
    if (entry === undefined) {
      problems.push(`${path}: missing from the manifest`);
      continue;
    }
    if (entry.ownerValid && entry.row.owner !== owner) {
      problems.push(`${path}: owner is ${entry.row.owner}, expected ${owner}`);
    }
    if (!existsSync(join(root, path))) {
      problems.push(`${path}: file does not exist`);
      continue;
    }
    if (!entry.shaValid) continue;
    const actual = hashFile(root, path);
    if (entry.row.sha256 !== actual) {
      problems.push(
        `${path}: sha256 drift (recorded ${entry.row.sha256}, actual ${actual})`,
      );
    }
  }
  for (const path of rows.keys()) {
    if (!expected.has(path)) problems.push(`${path}: not in the freeze list`);
  }

  return problems;
}

function failDrift(problems) {
  console.error('check:device-contracts failed — device contract drift:');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('A legitimate contract change is:');
  console.error(
    '  node scripts/check-device-contracts.mjs --update --message "contract: <what changed>"',
  );
  console.error('Lanes must not edit frozen files without a CONTRACT-REQUEST.');
  process.exit(1);
}

function main(argv) {
  let check = false;
  let update = false;
  let message;
  let root = resolve(import.meta.dirname, '..');

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      check = true;
    } else if (arg === '--update') {
      update = true;
    } else if (arg === '--message') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        console.error('--message needs a value');
        console.error(USAGE);
        process.exit(1);
      }
      message = value;
      i += 1;
    } else if (arg.startsWith('--message=')) {
      message = arg.slice('--message='.length);
    } else if (arg.startsWith('--root=')) {
      const value = arg.slice('--root='.length);
      if (value === '') {
        console.error('--root needs a path, for example --root=/tmp/fixture');
        console.error(USAGE);
        process.exit(1);
      }
      root = resolve(process.cwd(), value);
    } else {
      console.error(`unknown argument: ${arg}`);
      console.error(USAGE);
      process.exit(1);
    }
  }

  if (check && update) {
    console.error('cannot combine --check and --update');
    console.error(USAGE);
    process.exit(1);
  }
  if (message !== undefined && !update) {
    console.error('--message is only valid with --update');
    console.error(USAGE);
    process.exit(1);
  }

  if (update) {
    if (message === undefined || !message.startsWith('contract:')) {
      console.error(
        '--update requires --message "contract: <what changed>"; a frozen-contract refresh is a contract commit',
      );
      process.exit(1);
    }
    const manifest = buildManifest(root);
    const target = join(root, MANIFEST_PATH);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `device contracts updated (${CONTRACT_FILES.length} files); commit with a contract: subject, ` +
        'then bump the device-contracts-vN tag before dependent lanes rebase',
    );
    return;
  }

  const target = join(root, MANIFEST_PATH);
  if (!existsSync(target)) {
    failDrift([`${MANIFEST_PATH}: manifest is missing`]);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(target, 'utf8'));
  } catch (error) {
    failDrift([`${MANIFEST_PATH}: manifest is not valid JSON (${error.message})`]);
  }
  const problems = checkManifest(root, manifest);
  if (problems.length > 0) failDrift(problems);

  console.log(
    `check:device-contracts passed (${CONTRACT_FILES.length} frozen files, tag ${CONTRACT_TAG})`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
