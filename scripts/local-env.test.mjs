import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const scriptUrl = pathToFileURL(resolve('scripts/local-env.mjs')).href;
const profileDir = resolve('output', 'desktop-webview');

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
