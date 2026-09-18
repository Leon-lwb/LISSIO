import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm dev:server --no-mcp --cors-origin http://localhost:1420 --config-dir src-tauri/target/e2e-config',
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
