import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MSVCRT_STUB_TARGET_ROOTS, removeStaleMsvcrtStubs, repoRoot } from './local-env.mjs';

const scriptUrl = pathToFileURL(resolve('scripts/local-env.mjs')).href;
const profileDir = resolve('output', 'desktop-webview');
const CXX_FRAME_HANDLER = '__CxxFrameHandler3';

// Load the executable script in Node, as the launcher does, including its CLI guard.
function applyDesktopEnv(env, platform) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { applyDesktopEnv } from ${JSON.stringify(scriptUrl)};
    const env = ${JSON.stringify(env)};
    const profile = applyDesktopEnv(env, ${JSON.stringify(platform)});
    const repeated = applyDesktopEnv(env, ${JSON.stringify(platform)});
    console.log(JSON.stringify({ env, profile, repeated }));
  `], { encoding: 'utf8' });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

describe('desktop development environment', () => {
  it('keeps one persistent Windows profile across repeated starts', () => {
    const result = applyDesktopEnv({ TEMP: 'existing-temp' }, 'win32');

    expect(result.profile).toBe(profileDir);
    expect(result.repeated).toBe(profileDir);
    expect(result.env).toEqual({
      TEMP: 'existing-temp',
      WEBVIEW2_USER_DATA_FOLDER: profileDir,
    });
  });

  it('preserves an explicitly selected WebView2 profile', () => {
    const env = { WEBVIEW2_USER_DATA_FOLDER: 'C:\\custom profile' };

    const result = applyDesktopEnv(env, 'win32');
    expect(result.profile).toBe('C:\\custom profile');
    expect(result.env).toEqual(env);
  });

  it.each(['linux', 'darwin'])('leaves %s unchanged', (platform) => {
    const env = { TEMP: 'existing-temp' };

    const result = applyDesktopEnv(env, platform);
    expect(result.profile).toBeNull();
    expect(result.env).toEqual(env);
  });
});

/**
 * The stale-stub cleanup is the one part of this prelude that reads a path the
 * repository split moved: `tauri-build` writes its 82-byte `msvcrt.lib`
 * placeholder under a `target/` tree, and the Rust workspace is `server/` while
 * the Tauri shell is `client/src-tauri/`. These cases pin both roots and the
 * removal rule, so a future layout change cannot quietly stop scanning one of
 * them — the symptom (LNK2001 for `__CxxFrameHandler3`) shows up far from here.
 */
describe('stale Tauri msvcrt.lib cleanup', () => {
  let scratch;

  beforeEach(() => {
    mkdirSync('output', { recursive: true });
    scratch = mkdtempSync(resolve('output', 'local-env-test-'));
  });

  afterEach(() => {
    if (!scratch.startsWith(resolve('output') + sep)) throw new Error('Unexpected test scratch path');
    rmSync(scratch, { recursive: true, force: true });
  });

  it('scans the Rust workspace and the Tauri shell target trees', () => {
    const roots = MSVCRT_STUB_TARGET_ROOTS.map((root) => relative(repoRoot, root).split(sep).join('/'));
    expect(roots).toEqual(['server/target', 'client/src-tauri/target']);
  });

  it('removes the placeholder and keeps a real library', () => {
    const buildDir = join(scratch, 'debug', 'build', 'lissio-build-script', 'out');
    mkdirSync(buildDir, { recursive: true });
    const stub = join(buildDir, 'msvcrt.lib');
    writeFileSync(stub, Buffer.alloc(82, 0));
    const real = join(scratch, 'debug', 'build', 'other-crate', 'out', 'msvcrt.lib');
    mkdirSync(join(scratch, 'debug', 'build', 'other-crate', 'out'), { recursive: true });
    writeFileSync(real, Buffer.concat([Buffer.alloc(9000, 0), Buffer.from(CXX_FRAME_HANDLER)]));

    expect(removeStaleMsvcrtStubs([scratch])).toEqual([stub]);
    expect(existsSync(stub)).toBe(false);
    expect(existsSync(real)).toBe(true);
  });

  it('reports nothing for a checkout without a cached placeholder', () => {
    expect(removeStaleMsvcrtStubs([join(scratch, 'absent')])).toEqual([]);
    expect(removeStaleMsvcrtStubs([scratch])).toEqual([]);
  });
});
