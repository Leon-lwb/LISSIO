#!/usr/bin/env node
// Contract drift check — Rust wire types must match the committed src/types/generated.
//
// Approach: run the exporter into a temporary directory and compare byte for byte against
// the workspace files; the workspace itself is never modified.
// A failure means the Rust wire types changed without re-running pnpm generate:contracts.
//
// Usage: pnpm check:contracts

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
// import.meta.dirname is a platform-native path; on Windows new URL(...).pathname yields
// a "/C:/..." form that existsSync treats as missing, making this check always fail there
const root = join(import.meta.dirname, '..');
const committedDir = join(root, 'src', 'types', 'generated');

if (!existsSync(committedDir)) {
  console.error('missing src/types/generated — run pnpm generate:contracts first');
  process.exit(1);
}

const tempDir = mkdtempSync(join(tmpdir(), 'lissio-contracts-'));
const result = spawnSync(
  'cargo',
  ['run', '-p', 'lissio-rpc-api', '--example', 'export_contracts'],
  {
    cwd: join(root, 'src-tauri'),
    stdio: 'inherit',
    env: {
      ...process.env,
      TS_RS_EXPORT_DIR: tempDir,
      TS_RS_LARGE_INT: 'number',
    },
  },
);

if (result.status !== 0) {
  rmSync(tempDir, { recursive: true, force: true });
  console.error(`contract export failed (exit ${result.status ?? 'signal'})`);
  process.exit(result.status ?? 1);
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

rmSync(tempDir, { recursive: true, force: true });

if (problems.length > 0) {
  console.error('check:contracts failed — generated output differs from the committed files:');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('Run pnpm generate:contracts and commit the updated generated directory.');
  process.exit(1);
}
console.log(`check:contracts passed (${committed.size} contract files)`);
