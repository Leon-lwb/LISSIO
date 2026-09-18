import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasTauriRuntime, resolveWebEndpoint } from '../index';

/// 端点解析: `?server=` → localStorage → 构建期变量 → 同源 (令牌同理)。
/// 查询参数只在带值时生效, 且解析后从地址栏摘掉 — 令牌不进浏览器历史。
///
/// jsdom 环境没有可用的 localStorage (Node 的 experimental 全局占位), 因此这里
/// 注入内存实现 — 生产代码对存储不可用是退化的 (退化为同源 / 本次会话生效)。

class MemoryStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

let storage: MemoryStorage;
let session: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  session = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('sessionStorage', session);
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('resolveWebEndpoint', () => {
  it('无配置时退回同源且不带令牌', () => {
    expect(resolveWebEndpoint()).toEqual({ base: window.location.origin, token: '' });
  });

  it('服务器写入 localStorage、令牌写入 sessionStorage，并从地址栏摘除', () => {
    window.history.replaceState({}, '', '/?server=127.0.0.1:9000&token=abc');
    expect(resolveWebEndpoint()).toEqual({ base: 'http://127.0.0.1:9000', token: 'abc' });
    expect(storage.getItem('lissio.server')).toBe('127.0.0.1:9000');
    expect(storage.getItem('lissio.token')).toBeNull();
    expect(session.getItem('lissio.token')).toBe('abc');
    expect(window.location.search).toBe('');

    // 无参再次解析: 从对应存储读回, 链接可以只发一次
    expect(resolveWebEndpoint()).toEqual({ base: 'http://127.0.0.1:9000', token: 'abc' });
  });

  it('保留显式 scheme 与反向代理路径前缀', () => {
    window.history.replaceState({}, '', '/?server=https://example.com/lissio/');
    expect(resolveWebEndpoint().base).toBe('https://example.com/lissio');
  });

  it('空参数值不写入 localStorage (只摘除参数)', () => {
    window.history.replaceState({}, '', '/?token=');
    expect(resolveWebEndpoint().token).toBe('');
    expect(session.getItem('lissio.token')).toBeNull();
  });

  it('存储不可用时退化为同源, 不抛异常', () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('sessionStorage', undefined);
    expect(resolveWebEndpoint()).toEqual({ base: window.location.origin, token: '' });
  });

  it('测试环境下被标记为 Tauri 宿主 — 桌面出口选择依据', () => {
    // src/test/setup.ts 注入了 __TAURI_INTERNALS__, 各测试据此走桌面 transport
    expect(hasTauriRuntime()).toBe(true);
  });
});
