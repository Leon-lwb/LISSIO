#!/usr/bin/env node
/**
 * prepare-sidecar.mjs — build the backend server and place it as the Tauri sidecar.
 *
 * Why this script crosses repositories: the desktop shell lives in `client/` and
 * its `tauri.conf.json` externalBin entry expects
 * `client/src-tauri/binaries/lissio-server-<target-triple>`, while the server it
 * embeds is the Rust workspace in `server/`. This is the one place that builds
 * one and copies into the other, so neither repository needs a path into the
 * other's build directory.
 *
 * Usage:
 *   pnpm prepare:sidecar [--release] [--target=<triple>]
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** The Rust workspace that produces `lissio-server`. */
const serverRoot = join(repoRoot, 'server');
/** Where the Tauri shell reads its external binary from. */
const binariesDir = join(repoRoot, 'client', 'src-tauri', 'binaries');

const manifest = join(serverRoot, 'Cargo.toml');
if (!existsSync(manifest)) {
  console.error(`error: ${manifest} is missing; check out the server submodule before preparing the sidecar.`);
  process.exit(1);
}

const release = process.argv.includes('--release');
const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
const host = spawnSync('rustc', ['-vV'], { encoding: 'utf8' });
if (host.status !== 0) throw new Error(host.stderr || 'rustc -vV failed');
const target = targetArg?.slice('--target='.length) ?? /^host: (.+)$/m.exec(host.stdout)?.[1];
if (!target) throw new Error('Unable to determine Rust target triple');

const args = ['build', '--manifest-path', manifest, '-p', 'lissio-backend-server'];
if (targetArg) args.push('--target', target);
if (release) args.push('--release');
const built = spawnSync('cargo', args, {
  stdio: 'inherit',
  env: { ...process.env, CARGO_INCREMENTAL: '0' },
});
if (built.status !== 0) process.exit(built.status ?? 1);

const extension = target.includes('windows') ? '.exe' : '';
const profile = release ? 'release' : 'debug';
const targetDir = join(serverRoot, 'target');
const source = targetArg
  ? join(targetDir, target, profile, `lissio-server${extension}`)
  : join(targetDir, profile, `lissio-server${extension}`);
mkdirSync(binariesDir, { recursive: true });
const destination = join(binariesDir, `lissio-server-${target}${extension}`);
cpSync(source, destination);
console.log(`Prepared sidecar: ${destination}`);
