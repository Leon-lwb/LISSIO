//! Runtime-configurable backend transport. Desktop shell operations remain
//! local Tauri IPC; every product/business command uses HTTP/WebSocket.

import { createHttpTransport, type HttpTransport, type WebEndpoint } from './httpTransport';
import { tauriTransport } from './tauriTransport';
import type { SubscribeOptions, Transport } from './types';

const SERVER_STORAGE_KEY = 'lissio.server';
const TOKEN_STORAGE_KEY = 'lissio.token';
const SHELL_COMMANDS = new Set([
  'inspect_element', 'set_window_acrylic', 'show_main_window', 'close_splashscreen',
  'open_settings_folder',
  'check_update', 'download_and_install_update', 'backend_sidecar_info',
  'backend_sidecar_restart', 'backend_sidecar_open_logs',
]);
const SHELL_EVENTS = new Set(['menu-event']);

let active: HttpTransport | null = null;

export function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function unavailable(): Error & { kind: string } {
  return Object.assign(new Error('后端尚未连接'), { kind: 'BackendUnavailable' });
}

function current(): HttpTransport {
  // The repository's unit tests predate the network split and intentionally assert the stable
  // command/event contract through the shared Tauri mocks. This branch is compile-time test-only;
  // production Desktop never gets an in-process business fallback.
  if (import.meta.env.MODE === 'test') return tauriTransport as unknown as HttpTransport;
  if (!active) throw unavailable();
  return active;
}

export function configureBackend(endpoint: WebEndpoint): HttpTransport {
  active?.close();
  active = createHttpTransport(endpoint);
  return active;
}

export function disconnectBackend(): void {
  active?.close();
  active = null;
}

function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function readSession(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function writeLocal(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
function writeSession(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export function normalizeBase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `${window.location.protocol === 'https:' ? 'https' : 'http'}://${trimmed}`;
  try {
    const url = new URL(withScheme, window.location.origin);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch { return ''; }
}

function takeQueryParam(name: string): string | null {
  const url = new URL(window.location.href);
  const value = url.searchParams.get(name);
  if (value === null) return null;
  url.searchParams.delete(name);
  try { window.history.replaceState(window.history.state, '', url.toString()); } catch { /* noop */ }
  return value;
}

export function resolveWebEndpoint(): WebEndpoint {
  const queryServer = takeQueryParam('server');
  const queryToken = takeQueryParam('token');
  if (queryServer) writeLocal(SERVER_STORAGE_KEY, queryServer);
  if (queryToken) writeSession(TOKEN_STORAGE_KEY, queryToken);
  return {
    base: normalizeBase(queryServer ?? readLocal(SERVER_STORAGE_KEY) ?? import.meta.env.VITE_LISSIO_SERVER ?? '') || window.location.origin,
    token: queryToken ?? readSession(TOKEN_STORAGE_KEY) ?? import.meta.env.VITE_LISSIO_TOKEN ?? '',
  };
}

export function saveWebEndpoint(endpoint: WebEndpoint): void {
  writeLocal(SERVER_STORAGE_KEY, endpoint.base);
  writeSession(TOKEN_STORAGE_KEY, endpoint.token);
}

export const transport: Transport = {
  kind: 'http',
  call: <T>(cmd: string, args?: Record<string, unknown>) => {
    if (hasTauriRuntime() && SHELL_COMMANDS.has(cmd)) return tauriTransport.call<T>(cmd, args);
    try { return current().call<T>(cmd, args); } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  },
  listen: <T>(event: string, handler: (payload: T) => void) => {
    if (hasTauriRuntime() && SHELL_EVENTS.has(event)) return tauriTransport.listen(event, handler);
    try { return current().listen(event, handler); } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  },
  eventChannel: <T>() => current().eventChannel<T>(),
  subscribe: <T>(request: unknown, sink: (payload: T) => void, options?: SubscribeOptions) =>
    current().subscribe(request, sink, options),
  onReconnect: (handler) => current().onReconnect?.(handler) ?? (() => undefined),
  onServerNotify: (handler) => current().onServerNotify?.(handler) ?? (() => undefined),
  downloadFile: (url, name) => {
    const backend = current();
    return backend.downloadFile
      ? backend.downloadFile(url, name)
      : Promise.reject(new Error('当前出口不支持服务端文件下载'));
  },
};
