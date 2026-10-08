#!/usr/bin/env node
/**
 * release-prepare.mjs — prepare a release locally: change files → version +
 * CHANGELOG + version-file synchronization.
 *
 * Why it stays local instead of running in CI: packaging itself needs a native
 * macOS host (see RELEASING.md), and version preparation must happen on the same
 * machine as packaging. The step therefore needs no token and adds no workflow.
 * On the CI side, `check:changes` and `check:release-sync` guard the change-file
 * format and the version/CHANGELOG relation.
 *
 * Steps:
 *   1. `covector version`          — consume .changes/*.md, compute the version,
 *                                    write package.json, generate the CHANGELOG
 *                                    entry, and trigger the postversion hook
 *                                    (the hook normalizes the CHANGELOG back to
 *                                    Keep a Changelog).
 *   2. `set-version.mjs <version>` — propagate the version to tauri.conf.json
 *                                    (the base version without the prerelease
 *                                    suffix), [workspace.package], the internal
 *                                    [workspace.dependencies], and Cargo.lock.
 *                                    It remains the only writer of those files.
 *
 * Usage:
 *   pnpm release:prepare                      run it
 *   pnpm release:prepare -- --dry-run         print covector's decision, write nothing
 *   pnpm release:prepare -- --allow-dirty     allow a dirty working tree
 *   pnpm release:prepare -- --no-set-version  run covector only (debugging)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const allowDirty = args.includes('--allow-dirty');
const skipSetVersion = args.includes('--no-set-version');

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: pnpm release:prepare [--dry-run] [--allow-dirty] [--no-set-version]');
  process.exit(0);
}

const bin = join(repoRoot, 'node_modules', '.bin', 'covector');
if (!existsSync(bin)) {
  console.error('The covector devDependency is missing: run pnpm install first.');
  process.exit(1);
}

const run = (cmd, argv) => execFileSync(cmd, argv, { cwd: repoRoot, stdio: 'inherit' });

const changesDir = join(repoRoot, '.changes');
if (!existsSync(join(changesDir, 'config.json'))) {
  console.error('.changes/config.json is missing: cannot determine the version policy.');
  process.exit(1);
}

const pending = readdirSync(changesDir).filter(
  (name) => name.endsWith('.md') && !/^readme\.md$/i.test(name),
);
if (pending.length === 0) {
  console.error('No pending change files: add a .md under .changes/ first (see .changes/README.md).');
  process.exit(1);
}

if (!dryRun && !allowDirty) {
  const dirty = execFileSync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  if (dirty) {
    console.error('The working tree is dirty; refusing to decide a version on uncommitted state:');
    for (const line of dirty.split('\n')) console.error(`  ${line}`);
    console.error('Commit or stash first; pass --allow-dirty to continue on a dirty tree deliberately.');
    process.exit(1);
  }
}

console.log(`Pending change files: ${pending.length} (${pending.join(', ')})`);

if (dryRun) {
  run(bin, ['version', '--dry-run']);
  console.log('\n[dry-run] No files were modified.');
  process.exit(0);
}

run(bin, ['version']);

const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
console.log(`\nVersion resolved to ${version}`);

if (!skipSetVersion) {
  run(process.execPath, [join(repoRoot, 'scripts', 'set-version.mjs'), version]);
}

console.log(
  [
    '',
    '--- Next steps ---',
    '1. Review git diff: CHANGELOG.md / package.json / src-tauri/{Cargo.toml,tauri.conf.json,Cargo.lock}',
    `2. git commit -m "chore(release): v${version}"`,
    `3. pnpm auto-build --version ${version}`,
    `4. pnpm publish:release --version ${version} --dry-run`,
    `5. pnpm publish:release --version ${version}`,
    `6. pnpm release:verify --version ${version}`,
  ].join('\n'),
);
