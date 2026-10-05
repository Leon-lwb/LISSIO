import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // 性能计量走 playwright.perf.config.ts：它要求串行单 worker，且产物要落到
  // 固定路径供 perf-collect 判定。这里必须排除，否则功能套件会顺手把它们也
  // 跑一遍 —— 在并行 worker 下抢 CPU，量出来的速率是噪声，还会污染产物。
  testIgnore: '**/perf/**',
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
