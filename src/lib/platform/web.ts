//! 平台服务 shim — 浏览器 (Web 出口) 实现。
//!
//! 浏览器没有 Tauri 的文件系统 / 原生对话框 / 进程 API, 这里给出等价能力或明确
//! 降级:
//! - 设置落服务端 `/api/v1/settings` (整篇 JSON 文档 `{ "app": {...} }`);
//! - "保存"退化为浏览器下载 (Blob + `<a download>`);
//! - "打开"用隐藏 `<input type="file">`, File 对象无法序列化成路径, 用模块级
//!   句柄 (`browser-file:<n>`) 指代;
//! - 退出无等价能力 (仅告警), 重启退化为刷新页面。

import { createBackendStore } from './backendStore';
import type { FileFilter, Platform } from './types';

/// 句柄前缀 — 与桌面真实文件路径区分, 读文件时据此查注册表。
const FILE_HANDLE_PREFIX = 'browser-file:';

/// 模块级 File 注册表 — 句柄只在当前页面会话内有效 (刷新即失效)。
const browserFiles = new Map<string, File>();
let nextFileHandle = 0;

function registerBrowserFile(file: File): string {
  nextFileHandle += 1;
  const handle = `${FILE_HANDLE_PREFIX}${nextFileHandle}`;
  browserFiles.set(handle, file);
  return handle;
}

/// 从句柄取 File — 未知句柄说明是跨会话/跨实现的旧值, 明确报错而不是静默读空。
function requireBrowserFile(handle: string): File {
  const file = browserFiles.get(handle);
  if (!file) throw new Error(`未知的浏览器文件句柄: ${handle}`);
  return file;
}

/// `defaultPath` → 下载文件名。
///
/// 浏览器没有"选择保存位置"这一步, `saveFile` 只能把 defaultPath 取 basename
/// 当作最终文件名返回; 真正的落盘发生在后续 `writeTextFile` (触发下载)。
/// 空值回退 `download.txt`, 保证 `<a download>` 总有文件名。
export function sanitizeDownloadName(defaultPath: string | undefined): string {
  const base = (defaultPath ?? '').split(/[\\/]/).pop()?.trim() ?? '';
  return base === '' ? 'download.txt' : base;
}

/// 把过滤器扩展名映射成 `accept` — `*` 不是合法扩展名 (整组过滤器只有 `*` 时
/// 返回空串 = 不过滤)。
function acceptAttribute(filters: FileFilter[] | undefined): string {
  if (!filters?.length) return '';
  const extensions = filters
    .flatMap((filter) => filter.extensions)
    .filter((extension) => extension !== '*')
    .map((extension) => `.${extension}`);
  return [...new Set(extensions)].join(',');
}

/// 触发浏览器下载 — Blob URL 挂到临时 `<a download>`, 点击后移除; 下一拍再
/// revoke (同步 revoke 可能让部分浏览器取消下载)。
function triggerDownload(filename: string, contents: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/// 隐藏 `<input type="file">` 选择, 返回句柄。取消 → null。
function pickBrowserFiles(options: {
  multiple?: boolean;
  directory?: boolean;
  filters?: FileFilter[];
}): Promise<string | string[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (options.multiple) input.multiple = true;
    if (options.directory) {
      // webkitdirectory 不在 DOM lib 类型里, 但 Chromium / WebKit 都已实现
      (input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true;
    }
    const accept = acceptAttribute(options.filters);
    if (accept) input.accept = accept;

    let settled = false;
    const finish = (value: string | string[] | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onWindowFocus);
      input.remove();
      resolve(value);
    };
    // 用户取消时多数浏览器既不触发 change 也不触发 cancel — 窗口重新聚焦后
    // 留一拍再判空兜底 (真正的选择会先触发 change 并 settle)。
    const onWindowFocus = () => {
      setTimeout(() => finish(null), 0);
    };

    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        finish(null);
        return;
      }
      const handles = files.map(registerBrowserFile);
      finish(options.multiple ? handles : handles[0]);
    });
    input.addEventListener('cancel', () => finish(null));
    window.addEventListener('focus', onWindowFocus);

    document.body.appendChild(input);
    input.click();
  });
}

export const webPlatform: Platform = {
  getAppVersion: () => Promise.resolve(import.meta.env.VITE_APP_VERSION ?? 'web'),
  getAppName: () => Promise.resolve('Lissio'),

  openUrl: (url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
    return Promise.resolve();
  },

  exitApp: () => {
    console.warn('[platform] 浏览器环境没有退出能力, 忽略 exitApp');
    return Promise.resolve();
  },
  relaunchApp: () => {
    window.location.reload();
    return Promise.resolve();
  },

  saveFile: (options) => Promise.resolve(sanitizeDownloadName(options.defaultPath)),
  openFile: (options) =>
    pickBrowserFiles({
      multiple: options.multiple,
      directory: options.directory,
      filters: options.filters,
    }),
  confirm: (message) => Promise.resolve(window.confirm(message)),
  ask: (message) => Promise.resolve(window.confirm(message)),

  readTextFile: async (path) => {
    const file = requireBrowserFile(path);
    return await file.text();
  },
  writeTextFile: (path, contents) => {
    triggerDownload(sanitizeDownloadName(path), contents, 'text/plain;charset=utf-8');
    return Promise.resolve();
  },
  readBinaryFile: async (path) => {
    const file = requireBrowserFile(path);
    return new Uint8Array(await file.arrayBuffer());
  },

  createStore: createBackendStore,
};
