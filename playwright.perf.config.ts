import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * 前端性能计量专用配置。
 *
 * 为什么单独一个配置，而不是给 e2e 加个 grep：
 *
 * - **串行**。计量要的是"这段代码单独跑要多久"，并行 worker 互相抢 CPU 会把
 *   数字搅成噪声。这里 workers=1，宁可慢也要让每个场景独占机器。
 * - **与功能测试分开**。功能测试的失败重试、超时、并发都不该影响计量；反过来，
 *   计量也不该因为一个场景卡住就阻塞功能门禁。分成两步，哪步红了就查哪步。
 * - **只收 perf 目录**。避免有人给 e2e 加用例时被顺手卷进性能门禁。
 *
 * webServer 沿用基础配置：前后端服务是同一套，不重复拉起逻辑。
 */
export default defineConfig({
  ...base,
  testDir: './e2e/perf',
  // 必须显式清空: 基础配置为了把计量排除出功能套件, 设了 testIgnore '**/perf/**'。
  // 那条规则是从 base 展开继承过来的, 不覆盖的话本配置会把自己的用例也一起忽略,
  // 表现为 "No tests found" —— 一个静默失效的计量步骤比没有计量更糟。
  testIgnore: undefined,
  fullyParallel: false,
  workers: 1,
  // 计量失败不重试：重试会让"第一次偶然慢"被当成真实结果覆盖掉。
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
});