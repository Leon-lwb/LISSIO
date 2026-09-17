//! platform 运行时选择 — 两个分支只差 `window.__TAURI_INTERNALS__` 是否存在。
//!
//! 选择在模块加载期做一次, 因此必须 `vi.resetModules()` 后重新 import;
//! setup.ts 默认注入该标记 (让全量既有测试走桌面实现), 这里临时摘掉验证 Web 分支。

import { afterEach, describe, expect, it, vi } from 'vitest';

/// setup.ts 注入的原始值 — 每个用例后恢复, 避免污染同文件后续导入。
const tauriInternals = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

function setTauriRuntime(present: boolean): void {
  const target = window as unknown as { __TAURI_INTERNALS__?: unknown };
  if (present) target.__TAURI_INTERNALS__ = tauriInternals;
  else delete target.__TAURI_INTERNALS__;
}

describe('platform 运行时选择', () => {
  afterEach(() => {
    vi.resetModules();
    setTauriRuntime(true);
  });

  it('存在 __TAURI_INTERNALS__ 时选桌面实现', async () => {
    setTauriRuntime(true);
    vi.resetModules();
    const [{ platform }, { tauriPlatform }] = await Promise.all([
      import('../index'),
      import('../tauri'),
    ]);
    expect(platform).toBe(tauriPlatform);
  });

  it('无 __TAURI_INTERNALS__ 时选 Web 实现', async () => {
    setTauriRuntime(false);
    vi.resetModules();
    const [{ platform }, { webPlatform }] = await Promise.all([
      import('../index'),
      import('../web'),
    ]);
    expect(platform).toBe(webPlatform);
  });
});
