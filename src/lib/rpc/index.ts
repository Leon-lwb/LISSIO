//! transport 选择与端点解析。
//!
//! 选择规则: Tauri webview 里 `window.__TAURI_INTERNALS__` 存在 → 桌面 IPC
//! (波形走 `Channel` 二进制快路径, 行为与性能零变化); 否则 → HTTP/WS。
//!
//! 端点解析 (仅 Web 出口): `?server=` → `localStorage['lissio.server']` →
//! 构建期 `VITE_LISSIO_SERVER` → 同源; 令牌同理 (`?token=` →
//! `localStorage['lissio.token']` → `VITE_LISSIO_TOKEN`)。查询参数带值时写回
//! localStorage 并把它从地址栏摘掉 — 便于"发一次带参链接, 之后免参直达",
//! 也避免令牌留在浏览器历史里。

import { createHttpTransport, type WebEndpoint } from './httpTransport';
import { tauriTransport } from './tauriTransport';
import type { Transport } from './types';

const SERVER_STORAGE_KEY = 'lissio.server';
const TOKEN_STORAGE_KEY = 'lissio.token';

/// 桌面出口判定 — Tauri 在 window 上注入 `__TAURI_INTERNALS__`。
export function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // 隐私模式 / 禁用存储: 端点退化为同源
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 存储不可用时仅本次会话生效
  }
}

/// 归一化服务地址 — 允许 `host:port` 简写, 也保留反向代理的路径前缀。
function normalizeBase(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `${window.location.protocol === 'https:' ? 'https' : 'http'}://${trimmed}`;
  try {
    const url = new URL(withScheme, window.location.origin);
    // 路径前缀 (反向代理) 保留, 尾斜杠由拼接方统一处理
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

/// 读查询参数并在成功写入 localStorage 后把它从地址栏摘掉 (令牌不进历史)。
function takeQueryParam(name: string, storageKey: string): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const value = url.searchParams.get(name);
  if (value === null) return null;
  if (value !== '') writeStorage(storageKey, value);
  url.searchParams.delete(name);
  try {
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    // replaceState 在沙箱 iframe 等环境可能被拒 — 参数已生效, 忽略
  }
  return value;
}

/// 解析 Web 出口端点。
export function resolveWebEndpoint(): WebEndpoint {
  const fromQuery = takeQueryParam('server', SERVER_STORAGE_KEY);
  const base =
    normalizeBase(fromQuery ?? readStorage(SERVER_STORAGE_KEY) ?? envServer()) ||
    window.location.origin;

  const tokenQuery = takeQueryParam('token', TOKEN_STORAGE_KEY);
  const token = tokenQuery ?? readStorage(TOKEN_STORAGE_KEY) ?? envToken() ?? '';

  return { base, token };
}

function envServer(): string {
  return import.meta.env.VITE_LISSIO_SERVER ?? '';
}

function envToken(): string {
  return import.meta.env.VITE_LISSIO_TOKEN ?? '';
}

function selectTransport(): Transport {
  return hasTauriRuntime() ? tauriTransport : createHttpTransport(resolveWebEndpoint());
}

/// 当前出口 — 全应用共用的唯一实例 (订阅登记与事件监听表都是进程级的)。
export const transport: Transport = selectTransport();
