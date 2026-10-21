#!/usr/bin/env node
/**
 * verify-release.mjs — post-publish verification: confirm the release, the assets, and the updater manifest really work.
 *
 * Why this is needed: auto-update was broken for a full year because the manifest URL pointed at a
 * 404 repository, and no check ever actually performed a GET on that URL. Static string tests can
 * only prove "the address was not changed incorrectly"; they cannot prove "the address returns
 * something". This script makes real requests.
 *
 * Usage:
 *   pnpm release:verify --version 0.8.0
 *   pnpm release:verify --version 0.8.0-beta.1
 *   pnpm release:verify --version 0.8.0 --json
 *
 * Exit code 1 means something is wrong; every item in the output states the specific reason and a reproduce URL.
 */

const REPO = 'lissio-industries/Lissio';
const API_ROOT = `https://codeberg.org/api/v1/repos/${REPO}`;
const DOWNLOAD_ROOT = `https://codeberg.org/${REPO}/releases/download`;

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const versionIndex = args.indexOf('--version');
const version = versionIndex >= 0 ? args[versionIndex + 1] : null;

if (args.includes('--help') || args.includes('-h') || !version) {
  console.log(
    [
      'Usage: pnpm release:verify --version <vX.Y.Z> [--json]',
      '',
      `  --version <v>  Published version to verify, for example 0.8.0 or 0.8.0-beta.1`,
      '  --json         Output the result as JSON',
      '',
      'Checks: whether the release exists, whether the required assets are complete, whether the',
      'updater manifest is fetchable, and whether every platform URL in it returns 200.',
    ].join('\n'),
  );
  process.exit(version ? 0 : 1);
}

const tagOverride = args.indexOf('--tag') >= 0 ? args[args.indexOf('--tag') + 1] : null;
/** Version → candidate tags. Historically there were unprefixed tags (e.g. `0.7.2-beta`); new releases use `vX.Y.Z` uniformly. */
const candidateTags = tagOverride ? [tagOverride] : [`v${version}`, version];
const isPrerelease = version.includes('-');
const channelTag = isPrerelease ? 'beta' : 'stable';
const channelAsset = isPrerelease ? 'beta-latest.json' : 'latest.json';

const results = [];
const record = (ok, label, detail) => results.push({ ok, label, detail });

async function head(url) {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return response.status;
  } catch (error) {
    return `ERR ${error.message}`;
  }
}

async function getJson(url) {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return { error: `${response.status} ${response.statusText}` };
    return { body: await response.json() };
  } catch (error) {
    return { error: error.message };
  }
}

// ── 1. Does the release exist (tolerating historical unprefixed tags) ──
let tag = candidateTags[0];
let release = { error: 'not attempted' };
for (const candidate of candidateTags) {
  const found = await getJson(`${API_ROOT}/releases/tags/${encodeURIComponent(candidate)}`);
  if (!found.error) {
    tag = candidate;
    release = found;
    break;
  }
  release = found;
}
if (release.error) {
  record(
    false,
    `release ${candidateTags[0]} exists`,
    `GET ${API_ROOT}/releases/tags/${candidateTags[0]} → ${release.error}`,
  );
} else {
  record(true, `release ${tag} exists`, `${release.body.assets?.length ?? 0} asset(s)`);
}

// ── 2. Are the required assets complete ──────────────────────
const assetNames = new Set((release.body?.assets ?? []).map((asset) => asset.name));
if (!release.error) {
  if (!assetNames.has('SHA256SUMS')) {
    record(false, 'SHA256SUMS uploaded', `checksum file missing; reproduce: ${DOWNLOAD_ROOT}/${tag}/SHA256SUMS`);
  } else {
    record(true, 'SHA256SUMS uploaded', `${DOWNLOAD_ROOT}/${tag}/SHA256SUMS`);
  }

  // There must be at least one installer, or this release means nothing to users.
  const installers = [...assetNames].filter((name) =>
    /\.(dmg|msi|exe|deb|AppImage)$/.test(name),
  );
  record(
    installers.length > 0,
    'at least one installer',
    installers.length > 0 ? installers.join(', ') : 'no installer assets found',
  );

  // Signed artifacts are a prerequisite for auto-update.
  const sigs = [...assetNames].filter((name) => name.endsWith('.sig'));
  record(
    sigs.length > 0,
    'updater signatures (.sig) present',
    sigs.length > 0
      ? `${sigs.length}: ${sigs.join(', ')}`
      : 'no .sig: auto-update cannot work (needs TAURI_SIGNING_PRIVATE_KEY, and bundle.createUpdaterArtifacts must be true)',
  );
}

// ── 3. The rolling channel manifest is fetchable ─────────────
const manifestUrl = `${DOWNLOAD_ROOT}/${channelTag}/${channelAsset}`;
const manifest = await getJson(manifestUrl);
let manifestBody = null;
if (manifest.error) {
  record(false, `channel manifest fetchable (${channelTag})`, `GET ${manifestUrl} → ${manifest.error}`);
} else {
  manifestBody = manifest.body;
  record(true, `channel manifest fetchable (${channelTag})`, manifestUrl);
}

// ── 4. Manifest content and every platform URL ───────────────
if (manifestBody) {
  const manifestVersion = manifestBody.version;
  record(
    manifestVersion === version,
    'manifest version matches expectation',
    `manifest ${manifestVersion} vs expected ${version}`,
  );

  const platforms = Object.entries(manifestBody.platforms ?? {});
  if (platforms.length === 0) {
    record(false, 'manifest has platform entries', 'platforms is empty: clients get no updates');
  }
  for (const [platform, entry] of platforms) {
    if (!entry?.url || !entry?.signature) {
      record(false, `platform ${platform} fields complete`, 'url or signature missing');
      continue;
    }
    const status = await head(entry.url);
    record(status === 200, `platform ${platform} URL downloadable`, `${status} ${entry.url}`);
  }
}

// ── Output ───────────────────────────────────────────────────
const failed = results.filter((result) => !result.ok);

if (asJson) {
  console.log(JSON.stringify({ version, tag, channelTag, results, ok: failed.length === 0 }, null, 2));
} else {
  console.log(`verifying published version v${version} (channel ${channelTag})`);
  console.log('');
  for (const result of results) {
    console.log(`  ${result.ok ? '✓' : '✗'} ${result.label}`);
    if (result.detail) console.log(`      ${result.detail}`);
  }
  console.log('');
  if (failed.length === 0) {
    console.log(`✓ v${version} verified — downloads and the auto-update chain work`);
  } else {
    console.log(`✗ v${version} has ${failed.length} failing item(s)`);
  }
}

process.exit(failed.length === 0 ? 0 : 1);
