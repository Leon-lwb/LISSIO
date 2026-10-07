import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // 性能计量走 playwright.perf.config.ts：它要求串行单 worker，且产物要落到
  // 固定路径供 perf-collect 判定。这里必须排除，否则功能套件会顺手把它们也
  // 跑一遍 —— 在并行 worker 下抢 CPU，量出来的速率是噪声，还会污染产物。
  testIgnore: '**/perf/**',
  timeout: 30_000,
  // 动画采样类断言 (e2e/sliding-pill.spec.ts) 靠 requestAnimationFrame 数静止帧:
  // 机器有负载时帧会变稀疏, 采样可能停在插值中途, 于是容差从 0.48px 的取整差
  // 涨到 1.7px 而误报。它在空闲机器上 8/8 通过, 只在满载时偶发。
  // 仅在 CI 重试: 本地失败仍应立即暴露。
  retries: process.env.CI ? 2 : 0,
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
