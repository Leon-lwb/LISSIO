import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

// Each test owns its backend and directory; it never changes the shared E2E state.
// The server is built from the `server/` submodule (`pnpm build:server`), so its debug
// binary lives in that workspace's target directory.
async function startBackend(configDir: string) {
  const child = spawn(resolve('server/target/debug/lissio-server'), [
    '--http-port', '0', '--token', 'e2e-token', '--no-mcp', '--no-restore',
    '--cors-origin', 'http://localhost:1420', '--config-dir', configDir, '--supervised-stdio',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  let diagnostics = '';
  child.stderr.on('data', (chunk: Buffer) => { diagnostics += chunk.toString(); });
  const base = await new Promise<string>((resolveReady, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Backend startup timed out: ${diagnostics}`));
    }, 15_000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => {
      clearTimeout(timeout);
      reject(new Error(`Backend exited before readiness: ${diagnostics}`));
    });
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = /LISSIO_READY=(\{[^\n]+\})/.exec(output);
      if (!match) return;
      const ready = JSON.parse(match[1]) as { port: number };
      clearTimeout(timeout);
      resolveReady(`http://127.0.0.1:${ready.port}`);
    });
  });
  return {
    base,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000);
      child.stdin.end();
      await exited;
      clearTimeout(timeout);
    },
  };
}

let configDir: string;
let settingsPath: string;
let backend: Awaited<ReturnType<typeof startBackend>>;

// The pinned color scheme keeps the guide's theme preselection deterministic (the language step
// no longer reads the locale: its default is English by design).
test.use({ locale: 'en-US', colorScheme: 'light' });

/// Upgrading users: a settings document already exists, so the configuration guide stays away
/// and these tests keep measuring the tour and the settings document only.
const document = (showOnboarding: boolean) => JSON.stringify({
  app: {
    general: { showOnboarding, autoCheckUpdate: false, language: 'zh', lastSeenVersion: '0.7.1' },
  },
});
const persistedOnboarding = async () => {
  const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as {
    app: { general: { showOnboarding: boolean } };
  };
  return settings.app.general.showOnboarding;
};
/// Tolerant reader: on a fresh installation the document does not exist until the first save
/// lands, and polling must see "not yet" rather than an ENOENT abort.
const persistedGeneral = async () => {
  try {
    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      app: { general: { language: string; lastSeenVersion: string | null } };
    };
    return settings.app.general;
  } catch {
    return null;
  }
};

test.beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'lissio-settings-e2e-'));
  settingsPath = join(configDir, 'settings.json');
  await writeFile(settingsPath, document(true));
  backend = await startBackend(configDir);
});
test.afterEach(async () => {
  await backend.stop();
  await rm(configDir, { recursive: true, force: true });
});

test('ending the tour survives backend restart and Help can replay it', async ({ page }) => {
  await page.goto(`/?server=${backend.base}&token=e2e-token`);
  await page.getByRole('button', { name: '结束引导', exact: true }).click();
  await expect.poll(persistedOnboarding).toBe(false);
  await backend.stop();
  backend = await startBackend(configDir);
  await page.goto(`/?server=${backend.base}&token=e2e-token`);
  await expect(page.locator('[data-tour="help"]')).toBeVisible();
  await expect(page.getByText('欢迎使用 Lissio', { exact: true })).toBeHidden();
  await page.locator('[data-tour="help"]').click();
  await page.getByRole('button', { name: '重新体验引导', exact: true }).click();
  await expect(page.getByText('欢迎使用 Lissio', { exact: true })).toBeVisible();
  await expect.poll(persistedOnboarding).toBe(false);
});

test('corrupt settings remain untouched and can be reloaded after repair', async ({ page }) => {
  const corrupt = '{ invalid json';
  await writeFile(settingsPath, corrupt);
  await page.goto(`/?server=${backend.base}&token=e2e-token`);
  await expect(page.getByText('无法读取设置，已暂停自动引导和设置保存', { exact: true })).toBeVisible();
  await expect(page.getByText('欢迎使用 Lissio', { exact: true })).toBeHidden();
  expect(await readFile(settingsPath, 'utf8')).toBe(corrupt);
  await writeFile(settingsPath, document(false));
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('无法读取设置，已暂停自动引导和设置保存', { exact: true })).toBeHidden();
  await expect(page.getByText('欢迎使用 Lissio', { exact: true })).toBeHidden();
  await expect.poll(persistedOnboarding).toBe(false);
});

test('failed dismissal saves offer a retry and persist the latest choice', async ({ page }) => {
  let failWrite = true;
  await page.route('**/api/v1/settings', async (route) => {
    if (route.request().method() === 'PUT' && failWrite) {
      await route.fulfill({ status: 503, body: '{}' });
    } else {
      await route.continue();
    }
  });
  await page.goto(`/?server=${backend.base}&token=e2e-token`);
  await page.getByRole('button', { name: '结束引导', exact: true }).click();
  await expect(page.getByText('设置保存失败，当前修改尚未保存', { exact: true })).toBeVisible();
  expect(await persistedOnboarding()).toBe(true);
  failWrite = false;
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('设置保存失败，当前修改尚未保存', { exact: true })).toBeHidden();
  await expect.poll(persistedOnboarding).toBe(false);
  await page.reload();
  await expect(page.locator('[data-tour="help"]')).toBeVisible();
  await expect(page.getByText('欢迎使用 Lissio', { exact: true })).toBeHidden();
});

test('a fresh installation meets the configuration guide instead of the workbench', async ({ page }) => {
  // Fresh installation: there is no settings document at all, which is the only path that
  // makes the guide appear on its own. An upgrading document never reaches it.
  await rm(settingsPath, { force: true });
  await page.goto(`/?server=${backend.base}&token=e2e-token`);

  // The guide is a page, not a dialog: the workbench is not mounted behind it, and the
  // language step opens in English because that is the guide's preselected default.
  await expect(page.locator('#config-guide-title')).toBeVisible();
  await expect(page.getByText('Configuration guide', { exact: true })).toBeVisible();
  await expect(page.locator('[data-tour="canvas"]')).toHaveCount(0);

  // The language switch is live and the changed field stops claiming to be the default.
  await page.getByRole('button', { name: '中文' }).click();
  await expect(page.getByText('配置引导', { exact: true })).toBeVisible();
  await expect(page.getByText('手动选择')).toBeVisible();

  // Walk to the last step and confirm.
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '开始使用' }).click();

  // Language changes save before confirmation, so wait for the completion marker too.
  // Checking its type rejects both null and an absent field while the save is pending.
  await expect.poll(async () => (await persistedGeneral())?.language).toBe('zh');
  await expect.poll(async () => typeof (await persistedGeneral())?.lastSeenVersion).toBe('string');

  // The workbench mounts only after the guide is confirmed, and the tour takes over.
  await expect(page.locator('[data-tour="canvas"]')).toHaveCount(1);
  await expect(page.getByText('欢迎使用 Lissio', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator('#config-guide-title')).toBeHidden();
});
