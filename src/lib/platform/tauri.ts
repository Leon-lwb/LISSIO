//! 平台服务 shim — 桌面 (Tauri webview) 实现。
//!
//! 全部是既有插件的薄委托, 语义与拆分前的直接调用逐字一致 —— 这样 `dist/`
//! 在 Tauri 宿主里行为零变化, 风险集中在 Web 实现。真正的 Tauri IPC (命令 /
//! 事件 / 订阅) 仍走 `src/lib/rpc/`, 不在这里。

import { getName, getVersion } from '@tauri-apps/api/app';
import { ask as dialogAsk, confirm as dialogConfirm, open, save } from '@tauri-apps/plugin-dialog';
import { readFile, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { openUrl as openerOpenUrl } from '@tauri-apps/plugin-opener';
import { exit, relaunch } from '@tauri-apps/plugin-process';
import { LazyStore } from '@tauri-apps/plugin-store';
import type { Platform, PlatformStore } from './types';

export const tauriPlatform: Platform = {
  getAppVersion: () => getVersion(),
  getAppName: () => getName(),

  openUrl: (url) => openerOpenUrl(url),

  exitApp: (code) => exit(code),
  relaunchApp: () => relaunch(),

  saveFile: (options) =>
    save({ defaultPath: options.defaultPath, filters: options.filters }),

  // 单选返回 string | null, 多选返回 string[] | null — 与 plugin-dialog 的
  // `open` 契约一致, 调用点按需收窄。
  openFile: async (options) => {
    const selected: unknown = await open({
      multiple: options.multiple ?? false,
      directory: options.directory ?? false,
      filters: options.filters,
      title: options.title,
    });
    if (!selected) return null;
    if (typeof selected === 'string') return selected;
    if (Array.isArray(selected)) {
      return (selected as unknown[]).filter((path): path is string => typeof path === 'string');
    }
    return null;
  },

  confirm: (message, options) => dialogConfirm(message, options),
  ask: (message, options) => dialogAsk(message, options),

  readTextFile: (path) => readTextFile(path),
  writeTextFile: (path, contents) => writeTextFile(path, contents),
  readBinaryFile: (path) => readFile(path),

  createStore: (fileName): PlatformStore => {
    const store = new LazyStore(fileName);
    return {
      // LazyStore 未命中返回 undefined, 统一成 null 与 Web 实现对齐
      get: async <T,>(key: string): Promise<T | null> => (await store.get<T>(key)) ?? null,
      set: async (key: string, value: unknown): Promise<void> => {
        await store.set(key, value);
      },
    };
  },
};
