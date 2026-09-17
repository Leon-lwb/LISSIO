//! Web 设置存储 — 服务端整篇文档的 GET/PUT 形状与 Bearer 头。
//!
//! 端点走 mock 的 `resolveWebEndpoint`, 让 URL/令牌可控; 实现本身仍直接构造
//! `webPlatform.createStore`, 不依赖运行时全局。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/// 可变的端点 — 用来验证令牌为空时不发 Authorization。
const endpoint = vi.hoisted(() => ({ base: 'http://127.0.0.1:8790', token: 'secret' }));

vi.mock('../../rpc', () => ({
  resolveWebEndpoint: () => ({ base: endpoint.base, token: endpoint.token }),
}));

import { webPlatform } from '../web';

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

const fetchMock = vi.fn();

function calls(): FetchCall[] {
  return (fetchMock.mock.calls as unknown as [string, RequestInit?][]).map(([url, init]) => ({
    url,
    init,
  }));
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('webPlatform.createStore (服务端设置)', () => {
  beforeEach(() => {
    endpoint.base = 'http://127.0.0.1:8790';
    endpoint.token = 'secret';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('GET 拉取整篇文档并缓存, 带 Bearer 头', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ app: { theme: 'dark' } }));
    const store = webPlatform.createStore('settings.json');

    await expect(store.get('app')).resolves.toEqual({ theme: 'dark' });
    // 未命中的 key 返回 null; 文档已缓存, 不再发第二次请求
    await expect(store.get('missing')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [first] = calls();
    expect(first.url).toBe('http://127.0.0.1:8790/api/v1/settings');
    expect(first.init?.headers).toEqual({ Authorization: 'Bearer secret' });
  });

  it('set 合并 key 后整体 PUT, 带 content-type 与 Bearer', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ app: { theme: 'dark' }, other: 1 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 200));
    const store = webPlatform.createStore('settings.json');

    await store.set('app', { theme: 'light' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const put = calls()[1];
    expect(put.url).toBe('http://127.0.0.1:8790/api/v1/settings');
    expect(put.init?.method).toBe('PUT');
    expect(put.init?.headers).toEqual({
      Authorization: 'Bearer secret',
      'content-type': 'application/json',
    });
    // 只覆盖目标 key, 其余字段原样带回
    expect(JSON.parse(put.init?.body as string) as unknown).toEqual({
      app: { theme: 'light' },
      other: 1,
    });

    // 合并结果已缓存 — get 不再发请求
    await expect(store.get('app')).resolves.toEqual({ theme: 'light' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('令牌为空时不发 Authorization', async () => {
    endpoint.token = '';
    fetchMock.mockResolvedValueOnce(jsonResponse({ app: 1 }));
    const store = webPlatform.createStore('settings.json');

    await store.get('app');
    expect(calls()[0].init?.headers).toEqual({});
  });

  it('请求失败抛出带状态码的错误 (调用方据此落默认值)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    const store = webPlatform.createStore('settings.json');
    await expect(store.get('app')).rejects.toThrow(/HTTP 500/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ app: 1 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
    await expect(store.set('app', {})).rejects.toThrow(/HTTP 503/);
  });

  it('响应不是 JSON 对象时报错', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([1, 2, 3]));
    const store = webPlatform.createStore('settings.json');
    await expect(store.get('app')).rejects.toThrow(/不是 JSON 对象/);
  });
});
