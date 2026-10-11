//! Vitest 全局 setup — 注册 jest-dom 匹配器 + @tauri-apps/* mock 桩
//!
//! 目标: 让 components / stores / lib 模块可以在没有 Tauri 运行时的 jsdom 中
//! 被导入与测试, 而不触发真实 Tauri API (这些 API 在非 Tauri 环境会抛错).
//!
//! 用法: 测试中通过 `import { tauriMock } from '../../test/setup'` 访问共享状态,
//! 例如 seedFile() 预置 后端设置数据、断言 invoke 调用.

import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/// 共享、可重置的 mock 状态 — 通过 vi.hoisted 保证在 vi.mock 工厂中可用
const tauriMock = vi.hoisted(() => {
  /** Backend settings document: file -> (key -> value). */
  const fileStore = new Map<string, Map<string, unknown>>();

  /// 目录契约版本 — 必须与 MODEL_CATALOG_CONTRACT_VERSION 一致 (v2: 目录下发 panels)。
  /// 这里只能写字面量 (vi.hoisted 工厂先于 import 执行), 漂移由
  /// store/__tests__/modelCatalogStore.test.ts 的守卫用例拦住。
  const catalogContractVersion = 2;

  return {
    fileStore,
    settingsGet: vi.fn((file: string, key: string): Promise<unknown> =>
      Promise.resolve(fileStore.get(file)?.get(key) ?? null)),
    settingsSet: vi.fn((file: string, key: string, value: unknown): Promise<void> => {
      let entry = fileStore.get(file);
      if (!entry) {
        entry = new Map();
        fileStore.set(file, entry);
      }
      entry.set(key, structuredClone(value));
      return Promise.resolve();
    }),
    catalogContractVersion,

    /** 预置某个 store 文件/键的数据 (供 load 路径测试) */
    seedFile: (file: string, key: string, value: unknown) => {
      let entry = fileStore.get(file);
      if (!entry) {
        entry = new Map();
        fileStore.set(file, entry);
      }
      entry.set(key, value);
    },

    // ---- @tauri-apps/api/core ----
    // 模型目录三命令给出最小合法响应 — 让目录就绪路径 (BackendConnectionGate
    // 启动屏障 / modelCatalogStore.load) 在组件测试中可走通;
    // 其余命令保持 resolve(undefined) (与拆分前一致), 需要数据的用例自行 mock。
    invoke: vi.fn((cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
      if (cmd === 'get_model_catalog') {
        return Promise.resolve({
          contractVersion: catalogContractVersion,
          revision: 'rev-mock',
          models: [],
        });
      }
      if (cmd === 'list_ports') {
        // 端口刷新 (bootstrap 阶段) 的最小合法响应 — 否则 undefined 会被展开成
        // 非数组, 走进失败分支产生噪声通知
        return Promise.resolve([]);
      }
      if (cmd === 'get_recording_health') {
        // 录制健康 (dialogs 阶段) — 只读取 warning 字段, 这里给最小合法响应;
        // 需要特定 warning 的用例自行 spy 覆盖 (RunControls.recording 同款)
        return Promise.resolve({
          warning: null,
          failed: null,
          accepted_batches: 0, accepted_bytes: 0, persisted_batches: 0,
          persisted_bytes: 0, accepted_sequence: 0, persisted_sequence: 0,
          queued_batches: 0, dropped_batches: 0, rejected_batches: 0,
          enabled: true,
        });
      }
      if (cmd === 'describe_node_documents') {
        const request = (args ?? {}) as { requestRevision?: number };
        return Promise.resolve({ requestRevision: request.requestRevision ?? 0, nodes: [] });
      }
      return Promise.resolve(undefined);
    }),

    // ---- @tauri-apps/api/event ----
    listen: vi.fn(() => Promise.resolve(() => undefined)),

    // ---- @tauri-apps/plugin-dialog ----
    dialogSave: vi.fn(() => Promise.resolve(null)),
    dialogOpen: vi.fn(() => Promise.resolve(null)),

    // ---- @tauri-apps/plugin-fs ----
    readTextFile: vi.fn(() => Promise.resolve('')),
    writeTextFile: vi.fn(() => Promise.resolve(undefined)),

    // ---- @tauri-apps/plugin-opener ----
    openUrl: vi.fn(() => Promise.resolve(undefined)),

    // ---- @tauri-apps/plugin-process ----
    relaunch: vi.fn(() => Promise.resolve(undefined)),
    exit: vi.fn(() => Promise.resolve(undefined)),
  };
});

export { tauriMock };

/// jsdom 未实现 window.matchMedia — uPlot 模块初始化 / AnimatedSwitch 动画均依赖。
/// 在 setup 阶段 (早于任何被测模块 import) 注入, 避免组件树加载时抛错。
vi.stubGlobal(
  'matchMedia',
  (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })
);

/// jsdom 未实现 ResizeObserver — StatusBar 分级收缩 / 多个图表组件依赖。
/// 桩不触发回调, 仅保证 observe/disconnect 可调用。
vi.stubGlobal(
  'ResizeObserver',
  class ResizeObserver {
    observe() { return undefined; }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
  }
);

/// jsdom 中把运行时标记为 Tauri 宿主 — `lib/rpc/index.ts` 据此选择桌面 transport,
/// `lib/platform/index.ts` 据此选择桌面插件实现, 于是各测试继续走下面 mock 的
/// `invoke` / `listen` / `Channel` / `@tauri-apps/plugin-*` (与拆分前的调用点等价)。
/// 直接赋值而非 `vi.stubGlobal`: 后者会被测试里的 `unstubAllGlobals()` 一并还原,
/// 导致同文件后续用例意外切到 Web 出口。
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: tauriMock.invoke,
  transformCallback: vi.fn(() => 0),
  unregisterCallback: vi.fn(),
};

/// 最小 Channel 桩 — 仅需可构造、含 id/onmessage 即可
function createChannelStub() {
  return class Channel<T = unknown> {
    id: number;
    onmessage: ((message: T) => void) | null = null;

    constructor(id?: number) {
      this.id = id ?? 0;
    }
  };
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriMock.invoke,
  Channel: createChannelStub(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauriMock.listen,
}));

vi.mock('../lib/platform/backendStore', () => ({
  createBackendStore: (file: string) => ({
    get: <T,>(key: string): Promise<T | null> =>
      tauriMock.settingsGet(file, key) as Promise<T | null>,
    set: (key: string, value: unknown): Promise<void> => tauriMock.settingsSet(file, key, value),
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: tauriMock.dialogOpen,
  save: tauriMock.dialogSave,
  ask: vi.fn(() => Promise.resolve(true)),
  confirm: vi.fn(() => Promise.resolve(true)),
  message: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: tauriMock.readTextFile,
  writeTextFile: tauriMock.writeTextFile,
  readFile: vi.fn(() => Promise.resolve(new Uint8Array())),
  writeFile: vi.fn(() => Promise.resolve(undefined)),
  exists: vi.fn(() => Promise.resolve(true)),
  mkdir: vi.fn(() => Promise.resolve(undefined)),
  remove: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: tauriMock.openUrl,
  openPath: vi.fn(() => Promise.resolve(undefined)),
  revealItemInDir: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: tauriMock.relaunch,
  exit: tauriMock.exit,
}));
