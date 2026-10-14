import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { seedSharedEndToEndConfig } from './e2e/seedSharedConfig';

// Every suite that does not own its own backend shares this config directory. A fresh
// checkout would otherwise start with no settings document, which the first-launch page
// reads as "never set up" — every spec would meet that modal before its own subject.
// The relative form is shared with the webServer command below, so the seed and the
// backend provably name the same directory (both resolve against the repo root).
const SHARED_CONFIG_DIR = 'src-tauri/target/e2e-config';
seedSharedEndToEndConfig(resolve(SHARED_CONFIG_DIR));

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  // Performance measurement lives in playwright.perf.config.ts: it requires a single serial
  // worker, and its artifacts must land at fixed paths for perf-collect to judge. They must be
  // excluded here, or the functional suite would run them too — competing for CPU under
  // parallel workers turns the measured rate into noise and pollutes the artifacts.
  testIgnore: '**/perf/**',
  timeout: 30_000,
  // Animation-sampling assertions (e2e/sliding-pill.spec.ts) count still frames via
  // requestAnimationFrame: under load frames become sparse, sampling can stop mid-interpolation,
  // so the tolerance grows from a 0.48px rounding difference to 1.7px and reports a false failure.
  // It passes 8/8 on an idle machine and only flakes when fully loaded.
  // Retry only in CI: local failures must still surface immediately.
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `pnpm dev:server --no-mcp --cors-origin http://localhost:1420 --config-dir ${SHARED_CONFIG_DIR}`,
      url: 'http://127.0.0.1:8790/api/v1/health',
      env: { LISSIO_TOKEN: 'e2e-token' },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'pnpm dev:web',
      url: 'http://localhost:1420',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
