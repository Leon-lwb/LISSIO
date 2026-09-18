import { cpSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const release = process.argv.includes('--release');
const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
const host = spawnSync('rustc', ['-vV'], { encoding: 'utf8' });
if (host.status !== 0) throw new Error(host.stderr || 'rustc -vV failed');
const target = targetArg?.slice('--target='.length) ?? /^host: (.+)$/m.exec(host.stdout)?.[1];
if (!target) throw new Error('Unable to determine Rust target triple');

const args = ['build', '--manifest-path', 'src-tauri/Cargo.toml', '-p', 'lissio-backend-server'];
if (targetArg) args.push('--target', target);
if (release) args.push('--release');
const built = spawnSync('cargo', args, {
  stdio: 'inherit',
  env: { ...process.env, CARGO_INCREMENTAL: '0' },
});
if (built.status !== 0) process.exit(built.status ?? 1);

const extension = target.includes('windows') ? '.exe' : '';
const profile = release ? 'release' : 'debug';
const source = targetArg
  ? resolve('src-tauri', 'target', target, profile, `lissio-server${extension}`)
  : resolve('src-tauri', 'target', profile, `lissio-server${extension}`);
const directory = resolve('src-tauri', 'binaries');
const destination = resolve(directory, `lissio-server-${target}${extension}`);
mkdirSync(directory, { recursive: true });
cpSync(source, destination);
console.log(`Prepared sidecar: ${destination}`);
