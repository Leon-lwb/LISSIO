//! Platform file, dialog, and process services. Settings always use the connected backend.

import { getName, getVersion } from '@tauri-apps/api/app';
import { ask as dialogAsk, confirm as dialogConfirm, open, save } from '@tauri-apps/plugin-dialog';
import { readFile, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { openUrl as openerOpenUrl } from '@tauri-apps/plugin-opener';
import { exit, relaunch } from '@tauri-apps/plugin-process';
import { createBackendStore } from './backendStore';
import type { Platform } from './types';

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

  createStore: createBackendStore,
};
