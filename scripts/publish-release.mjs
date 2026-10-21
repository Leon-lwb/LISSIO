#!/usr/bin/env node
/**
 * publish-release.mjs — publish local build artifacts to Codeberg and update the updater manifest.
 *
 * Why a script instead of curl inside the workflow:
 *   desktop installers cannot be built cross-platform on a single Linux runner, so packaging stays
 *   local (`pnpm auto-build`). The publish step runs on the same machine as packaging and reuses the
 *   same logic, so the workflow only has to call this script instead of copying the release details
 *   into YAML again.
 *
 * Usage:
 *   pnpm publish:release --version 0.8.0                 # stable release → stable channel
 *   pnpm publish:release --version 0.8.0-beta.1          # prerelease → beta channel
 *   pnpm publish:release --version 0.8.0 --dry-run       # only print what would be done
 *   pnpm publish:release --version 0.8.0 --assets output/build/artifacts-macos-arm64
 *
 * Requires the RELEASE_TOKEN environment variable: a Codeberg token with repository write access.
 * Never write the token into the repository; CI injects it from secrets.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API_ROOT = 'https://codeberg.org/api/v1/repos/lissio-industries/Lissio';
/** Asset download base URL. Codeberg does not implement GitHub's releases/latest/download pseudo-path. */
const DOWNLOAD_ROOT = 'https://codeberg.org/lissio-industries/Lissio/releases/download';
const repoRoot = join(import.meta.dirname, '..');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (flag('--help') || flag('-h')) {
  console.log(
    [
      'Usage: pnpm publish:release --version <vX.Y.Z> [options]',
      '',
      '  --version <v>    Required. The version to publish, for example 0.8.0 or 0.8.0-beta.1',
      '  --assets <dir>   Artifact directory, repeatable. Defaults to auto-discovering output/build/artifacts-*/',
      '  --draft          Create as a draft (not public, and does not update the updater channel)',
      '  --dry-run        Only print the operations that would run',
      '  --skip-checksums Do not generate SHA256SUMS',
      '',
      'Environment variable: RELEASE_TOKEN (Codeberg token, requires repository write access)',
    ].join('\n'),
  );
  process.exit(0);
}

const version = valueOf('--version');
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('error: --version <semver> is required, for example --version 0.8.0 or 0.8.0-beta.1');
  process.exit(1);
}

const dryRun = flag('--dry-run');
const isDraft = flag('--draft');
const token = process.env.RELEASE_TOKEN;
if (!token && !dryRun) {
  console.error('error: RELEASE_TOKEN is not set (Codeberg token, requires repository write access).');
  console.error('      Use --dry-run first to preview the operations that would run.');
  process.exit(1);
}

// Prerelease detection: a hyphen in the version marks it prerelease, matching Tauri's channel semantics.
const isPrerelease = version.includes('-');
const TAG = `v${version}`;
/** Rolling channel tag and manifest file name; clients read a fixed URL that does not change with the version. */
const CHANNEL_TAG = isPrerelease ? 'beta' : 'stable';
const CHANNEL_ASSET = isPrerelease ? 'beta-latest.json' : 'latest.json';

// ── Collect artifacts ────────────────────────────────────────
const explicitDirs = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--assets' && args[i + 1]) explicitDirs.push(args[i + 1]);
}

function defaultAssetDirs() {
  const base = join(repoRoot, 'output', 'build');
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((name) => name.startsWith('artifacts-'))
    .map((name) => join(base, name))
    .filter((dir) => statSync(dir).isDirectory());
}

const assetDirs = explicitDirs.length > 0 ? explicitDirs : defaultAssetDirs();
if (assetDirs.length === 0) {
  console.error('error: no artifact directory found. Run `pnpm auto-build` first, or specify one with --assets.');
  process.exit(1);
}

/** File name → absolute path; when the same name comes from multiple target directories, keep the first. */
const assets = new Map();
for (const dir of assetDirs) {
  if (!existsSync(dir)) {
    console.error(`error: artifact directory does not exist: ${dir}`);
    process.exit(1);
  }
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isFile()) continue;
    if (!assets.has(entry)) assets.set(entry, full);
  }
}

if (assets.size === 0) {
  console.error(`error: no files in the artifact directory: ${assetDirs.join(', ')}`);
  process.exit(1);
}

// ── Generate checksums ───────────────────────────────────────
function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

if (!flag('--skip-checksums')) {
  const lines = [...assets.entries()]
    .map(([name, path]) => [name, path])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, path]) => `${sha256(path)}  ${name}`);
  const sumsPath = join(assetDirs[0], 'SHA256SUMS');
  writeFileSync(sumsPath, `${lines.join('\n')}\n`);
  assets.set('SHA256SUMS', sumsPath);
  console.log(`generated SHA256SUMS (${lines.length} entries)`);
}

// ── Generate updater manifest ────────────────────────────────
function updaterPlatformKey(name) {
  if (name.endsWith('.app.tar.gz')) {
    if (name.includes('aarch64')) return 'darwin-aarch64';
    if (name.includes('x64')) return 'darwin-x86_64';
    return 'darwin-aarch64';
  }
  if (name.endsWith('.AppImage')) return 'linux-x86_64';
  if (name.endsWith('.nsis.zip')) return 'windows-x86_64';
  if (name.endsWith('-setup.exe')) return 'windows-x86_64';
  return null;
}

const platforms = {};
const skipped = [];
for (const [name] of assets) {
  const key = updaterPlatformKey(name);
  if (!key || platforms[key]) continue;
  const sigName = `${name}.sig`;
  if (!assets.has(sigName)) {
    skipped.push(`${name} (missing .sig signature)`);
    continue;
  }
  const signature = readFileSync(assets.get(sigName), 'utf8').trim();
  // Point at the immutable version tag, not the rolling channel tag: installers are fixed per
  // version (checksums and provenance are traceable) and only the manifest itself rolls. Pointing at
  // the channel tag would 404 these URLs, because installers are uploaded only to vX.Y.Z.
  platforms[key] = { signature, url: `${DOWNLOAD_ROOT}/${TAG}/${name}` };
}

let manifestPath = null;
if (Object.keys(platforms).length > 0) {
  manifestPath = join(assetDirs[0], CHANNEL_ASSET);
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        version,
        notes: `v${version}`,
        pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        platforms,
      },
      null,
      2,
    )}\n`,
  );
  assets.set(CHANNEL_ASSET, manifestPath);
} else {
  // Without signatures, do not publish a manifest: clients would reject it for the missing signature, creating a false impression of "update failed".
  console.warn('warning: no signed artifacts available, skipping the updater manifest (auto-update stays unavailable).');
}
if (skipped.length > 0) {
  console.warn(`warning: the following artifacts lack a .sig signature and did not enter the updater manifest:\n  ${skipped.join('\n  ')}`);
}

// ── Summary ──────────────────────────────────────────────────
console.log('');
console.log(`version:   ${version}${isPrerelease ? ' (prerelease)' : ''}`);
console.log(`tag:       ${TAG}`);
console.log(`channel:   ${CHANNEL_TAG} → ${CHANNEL_ASSET}${manifestPath ? '' : ' (skipped this run)'}`);
console.log(`artifacts: ${assetDirs.join(', ')}`);
console.log(`to upload: ${assets.size} file(s)`);
for (const [name] of assets) console.log(`  ${name}`);
if (dryRun) {
  console.log('');
  console.log('--dry-run: nothing was uploaded.');
  process.exit(0);
}

// ── Forgejo API ──────────────────────────────────────────────
async function api(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} → ${response.status} ${text.slice(0, 300)}`);
  }
  return body;
}

/** Find the release for the tag, creating it if absent; reuse an existing one so re-runs are idempotent. */
async function ensureRelease(tag, { prerelease, draft, body }) {
  try {
    const existing = await api(`/releases/tags/${encodeURIComponent(tag)}`);
    console.log(`release ${tag} already exists (id=${existing.id}), reusing`);
    return existing;
  } catch (error) {
    if (!/→ 404/.test(String(error.message))) throw error;
  }
  const created = await api('/releases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, name: tag, body, prerelease, draft }),
  });
  console.log(`created release ${tag} (id=${created.id})`);
  return created;
}

async function uploadAsset(releaseId, tag, name, path) {
  // A same-named asset must be deleted first, or re-publishing returns 409.
  const release = await api(`/releases/tags/${encodeURIComponent(tag)}`);
  const existing = (release.assets ?? []).find((asset) => asset.name === name);
  if (existing) {
    await api(`/releases/assets/${existing.id}`, { method: 'DELETE' });
    console.log(`  replacing same-named asset ${name}`);
  }
  const form = new FormData();
  form.append('attachment', new Blob([readFileSync(path)]), name);
  await api(`/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: form,
  });
  console.log(`  uploading ${name}`);
}

const releaseBody = [
  `## v${version}`,
  '',
  'See CHANGELOG.md for the full history.',
  '',
  'Verify the download with `SHA256SUMS`.',
].join('\n');

const release = await ensureRelease(TAG, {
  prerelease: isPrerelease,
  draft: isDraft,
  body: releaseBody,
});

for (const [name, path] of assets) {
  if (name === CHANNEL_ASSET) continue; // the manifest belongs to the rolling tag and is handled separately
  await uploadAsset(release.id, TAG, name, path);
}

// Update the rolling channel last: the assets the manifest points to must already exist, or clients get 404 links.
if (manifestPath) {
  if (isDraft) {
    console.log('draft release: not updating the rolling channel (so a draft does not notify installed clients early).');
  } else {
    const rolling = await ensureRelease(CHANNEL_TAG, {
      prerelease: true,
      draft: false,
      body: 'Rolling update channel manifest, maintained by CI/the release script. Do not delete.',
    });
    await uploadAsset(rolling.id, CHANNEL_TAG, CHANNEL_ASSET, manifestPath);
    console.log('');
    console.log(`channel updated: ${DOWNLOAD_ROOT}/${CHANNEL_TAG}/${CHANNEL_ASSET}`);
  }
}

console.log('');
console.log(`publish complete: ${API_ROOT.replace('/api/v1/repos', '')}/releases/tag/${TAG}`);
