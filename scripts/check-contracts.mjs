#!/usr/bin/env node
// Contract drift check — Rust wire types must match the committed src/types/generated.
//
// Approach: run every export program into one temporary directory and compare byte for byte
// against the workspace files; the workspace itself is never modified.
// A failure means the Rust wire types changed without re-running pnpm generate:contracts.
//
// Two further assertions read the exporters' machine-readable manifest
// (`ts-rs-export\t<Rust type path>\t<relative output file>\t<role>`):
//   1. no two distinct Rust types write the same `<TypeName>.ts` — otherwise the later
//      export silently wins and check:contracts regenerates the same collision forever;
//   2. the frontend does not re-declare a Web exit frame type outside src/types/generated —
//      frame types must be imported from the generated directory, not copied by hand.
//
// Usage: pnpm check:contracts

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
// import.meta.dirname is a platform-native path; on Windows new URL(...).pathname yields
// a "/C:/..." form that existsSync treats as missing, making this check always fail there
const root = join(import.meta.dirname, '..');
const committedDir = join(root, 'client', 'src', 'types', 'generated');

if (!existsSync(committedDir)) {
  console.error('missing client/src/types/generated — run pnpm generate:contracts first');
  process.exit(1);
}

// One export program per exit that defines wire types. Both write into the same
// TS_RS_EXPORT_DIR; rpc-api (L4) must not dev-depend backend-server (L5).
const EXPORTERS = [
  { package: 'lissio-rpc-api', example: 'export_contracts' },
  { package: 'lissio-backend-server', example: 'export_frames' },
];
const MANIFEST_PREFIX = 'ts-rs-export\t';

/** Parse the `ts-rs-export` manifest lines an export program prints on stdout. */
export function parseManifest(stdout) {
  const entries = [];
  for (const line of stdout.split('\n')) {
    if (!line.startsWith(MANIFEST_PREFIX)) continue;
    const [rustType, outputPath, role] = line.slice(MANIFEST_PREFIX.length).trimEnd().split('\t');
    if (rustType && outputPath && role) entries.push({ rustType, outputPath, role });
  }
  return entries;
}

/**
 * Distinct Rust types that would write the same generated file. The same Rust type
 * exported twice (a shared dependency such as `serde_json::Value`) is not a collision:
 * its `std::any::type_name` is identical, so the file content is identical too.
 */
export function findDuplicateOutputs(entries) {
  const owners = new Map();
  for (const { rustType, outputPath } of entries) {
    if (!owners.has(outputPath)) owners.set(outputPath, new Set());
    owners.get(outputPath).add(rustType);
  }
  return [...owners]
    .filter(([, types]) => types.size > 1)
    .map(([outputPath, types]) => ({ outputPath, types: [...types].sort() }));
}

// Export inside the workspace rather than the OS temp directory: the exporter is
// a child process, and a confined environment can deny it writes outside the
// checkout while still allowing the build tree. server/target is gitignored,
// so nothing written here can be committed.
const scratchRoot = join(root, 'server', 'target');
mkdirSync(scratchRoot, { recursive: true });
const tempDir = mkdtempSync(join(scratchRoot, 'contracts-check-'));

const manifest = [];
for (const { package: pkg, example } of EXPORTERS) {
  const result = spawnSync('cargo', ['run', '-p', pkg, '--example', example], {
    cwd: join(root, 'server'),
    encoding: 'utf8',
    env: {
      ...process.env,
      TS_RS_EXPORT_DIR: tempDir,
      TS_RS_LARGE_INT: 'number',
    },
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    rmSync(tempDir, { recursive: true, force: true });
    console.error(`contract export failed (${example}, exit ${result.status ?? 'signal'})`);
    process.exit(result.status ?? 1);
  }
  manifest.push(...parseManifest(result.stdout ?? ''));
}

/// Normalize line endings before comparing — workspace end-of-line style depends on the git
/// checkout (CRLF on Windows under core.autocrlf), while ts-rs always writes LF. Line endings
/// are not part of the wire contract, so normalize first; Linux/macOS checkouts are already LF,
/// making this a no-op there and keeping the comparison consistent across platforms.
function normalizeEol(content) {
  return content.replace(/\r\n/g, '\n');
}

/** Recursively collect relative path → content. */
function snapshot(dir) {
  const files = new Map();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const absolute = join(entry.parentPath ?? dir, entry.name);
    files.set(relative(dir, absolute), normalizeEol(readFileSync(absolute, 'utf8')));
  }
  return files;
}

/** Every frontend source file outside the generated directory. */
function frontendSources() {
  const sourceRoot = join(root, 'client', 'src');
  const files = [];
  for (const entry of readdirSync(sourceRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
    const absolute = join(entry.parentPath ?? sourceRoot, entry.name);
    if (absolute.startsWith(committedDir)) continue;
    files.push({ absolute, rel: relative(root, absolute) });
  }
  return files;
}

/** Strip comments so prose cannot look like a declaration. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** True when the source declares `name` locally (`interface X` / `type X =`). */
function declaresType(source, name) {
  const declaration = new RegExp(
    `\\b(?:interface\\s+${name}\\b|type\\s+${name}\\s*(?:<[^>]*>)?\\s*=)`,
  );
  return declaration.test(stripComments(source));
}

const committed = snapshot(committedDir);
const generated = snapshot(tempDir);
const problems = [];

for (const [rel, content] of committed) {
  if (!generated.has(rel)) {
    problems.push(`extra file (the type was removed on the Rust side): ${rel}`);
  } else if (generated.get(rel) !== content) {
    problems.push(`content drift: ${rel}`);
  }
}
for (const rel of generated.keys()) {
  if (!committed.has(rel)) {
    problems.push(`missing file (a type was added on the Rust side): ${rel}`);
  }
}

for (const { outputPath, types } of findDuplicateOutputs(manifest)) {
  problems.push(
    `duplicate generated output: ${outputPath} — ${types.join(' and ')} both write it, the last export wins`,
  );
}

const frameNames = new Map();
for (const { outputPath, role } of manifest) {
  if (role !== 'wire') continue;
  frameNames.set(basename(outputPath, '.ts'), outputPath);
}
const sources = frontendSources();
for (const [name, outputPath] of frameNames) {
  for (const { absolute, rel } of sources) {
    if (declaresType(readFileSync(absolute, 'utf8'), name)) {
      problems.push(
        `frontend re-declares exported frame type ${name}: ${rel} — import it from client/src/types/generated/${outputPath} instead`,
      );
    }
  }
}

rmSync(tempDir, { recursive: true, force: true });

if (problems.length > 0) {
  console.error('check:contracts failed — generated output differs from the committed files:');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('Run pnpm generate:contracts and commit the updated generated directory.');
  process.exit(1);
}
console.log(
  `check:contracts passed (${committed.size} contract files, ${manifest.length} exported types)`,
);
