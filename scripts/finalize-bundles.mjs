#!/usr/bin/env node
/** Finish native Windows installers in Tauri's existing bundle directory. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recovery = 'Run pnpm build:all from an ordinary Windows terminal outside the sandbox.';
const windowsTool = (name) => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', name);

export function readIntegrity(paths) {
  if (paths.length === 0) {
    // Query the numeric SID before Add-Type, whose compiler cannot run at Low integrity.
    const token = spawnSync(windowsTool('whoami.exe'), ['/groups', '/fo', 'csv', '/nh'], {
      encoding: 'utf8', windowsHide: true, timeout: 10_000,
    });
    const sids = token.stdout?.match(/"S-1-16-\d+"/g);
    if (token.status !== 0 || sids?.length !== 1) throw new Error('Cannot read the build process integrity SID');
    return { processSid: sids[0].slice(1, -1), paths: [] };
  }
  // Command input leaves the host's script-file execution policy unchanged.
  const helper = readFileSync(join(repoRoot, 'scripts', 'windows-integrity.ps1'), 'utf8');
  const result = spawnSync(windowsTool('WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(helper, 'utf16le').toString('base64')], {
      encoding: 'utf8', windowsHide: true, timeout: 30_000,
      env: { ...process.env, LISSIO_INTEGRITY_PATHS: JSON.stringify(paths) },
    });
  if (result.status !== 0) throw new Error(`Cannot read Windows integrity labels: ${result.error?.message ?? result.stderr}`);
  const info = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
  if (!/^S-1-16-\d+$/.test(info.processSid) || !Array.isArray(info.paths) ||
      info.paths.length !== paths.length || info.paths.some((entry, i) => entry.path !== paths[i] || !/^S-1-16-\d+$/.test(entry.sid))) {
    throw new Error('Invalid Windows integrity-label response');
  }
  return info;
}

export function setMediumIntegrity(path) {
  const result = spawnSync(windowsTool('icacls.exe'), [path, '/setintegritylevel', 'M'], {
    encoding: 'utf8', windowsHide: true, timeout: 10_000,
  });
  if (result.status !== 0) throw new Error(`Cannot set Medium integrity on ${path}: ${result.error?.message ?? result.stderr}`);
}

export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export function discoverInstallers(bundleDir, productName, version) {
  const prefix = `${productName}_${version}_`;
  return ['nsis', 'msi'].flatMap((kind) => {
    const dir = join(bundleDir, kind);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((name) => name.startsWith(prefix) &&
      (kind === 'nsis' ? name.endsWith('-setup.exe') : name.endsWith('.msi')))
      .sort().map((name) => join(dir, name));
  });
}

export async function finalizeInstallers(sources, inspect = readIntegrity, setMedium = setMediumIntegrity) {
  if (sources.length === 0) throw new Error('No current-version NSIS/MSI installers found after the desktop build.');
  for (const source of sources) {
    if (!lstatSync(source).isFile()) throw new Error(`Installer must be a regular file: ${source}`);
  }
  const processInfo = inspect([]);
  if (Number(processInfo.processSid.split('-').at(-1)) < 8192) {
    throw new Error(`Build process has ${processInfo.processSid}; Medium integrity is required.`);
  }
  const hashes = await Promise.all(sources.map(hashFile));
  const before = inspect(sources);
  for (const [i, source] of sources.entries()) {
    if (Number(before.paths[i].sid.split('-').at(-1)) < 8192) setMedium(source);
  }
  const after = inspect(sources);
  const ready = [];
  for (const [i, source] of sources.entries()) {
    if (Number(after.paths[i].sid.split('-').at(-1)) < 8192) throw new Error(`Installer still has ${after.paths[i].sid}: ${source}`);
    if (await hashFile(source) !== hashes[i]) throw new Error(`Installer bytes changed during integrity repair: ${source}`);
    ready.push({ path: source, sha256: hashes[i], sid: after.paths[i].sid });
  }
  return ready;
}

export async function finalizeBundles(platform = process.platform) {
  // Do not inspect Windows paths or invoke Windows tools on macOS/Linux.
  if (platform !== 'win32') { console.log('Windows installer integrity: skipped on this platform.'); return []; }
  const config = JSON.parse(readFileSync(join(repoRoot, 'client', 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const bundleDir = join(repoRoot, 'client', 'src-tauri', 'target', 'release', 'bundle');
  const sources = discoverInstallers(bundleDir, config.productName, config.version);
  for (const source of sources) {
    const rel = relative(realpathSync(repoRoot), realpathSync(source));
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Installer resolves outside the checkout: ${source}`);
  }
  const ready = await finalizeInstallers(sources);
  for (const artifact of ready) console.log(`Windows installer ready: ${artifact.path}\n  SHA256 ${artifact.sha256}\n  ${artifact.sid}`);
  return ready;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => {
    if (process.argv.length > 2) throw new Error('Bundle finalization takes no arguments.');
    return finalizeBundles();
  }).catch((error) => { console.error(`Bundle finalization failed: ${error.message}\n${recovery}`); process.exitCode = 1; });
}
