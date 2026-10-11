//! Both platform implementations persist through the current authenticated backend.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../backendStore');
const connection = vi.hoisted((): { current: { base: string; token: string } | null } => ({
  current: { base: 'http://127.0.0.1:8790', token: 'secret' },
}));
vi.mock('../../rpc', () => ({
  getBackendEndpoint: () => {
    if (!connection.current) throw new Error('Backend unavailable');
    return connection.current;
  },
}));

import { tauriPlatform } from '../tauri';
import { webPlatform } from '../web';

const fetchMock = vi.fn<typeof fetch>();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  connection.current = { base: 'http://127.0.0.1:8790', token: 'secret' };
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe.each([['Desktop', tauriPlatform], ['Web', webPlatform]] as const)('%s settings', (_, platform) => {
  it('reads fresh documents and sends the active connection token', async () => {
    fetchMock.mockResolvedValueOnce(response({ app: { theme: 'dark' } }));
    fetchMock.mockResolvedValueOnce(response({ app: { theme: 'light' } }));
    const store = platform.createStore('settings.json');
    await expect(store.get('app')).resolves.toEqual({ theme: 'dark' });
    await expect(store.get('app')).resolves.toEqual({ theme: 'light' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]).toEqual([
      'http://127.0.0.1:8790/api/v1/settings',
      { headers: { Authorization: 'Bearer secret' }, cache: 'no-store' },
    ]);
  });

  it('merges a key into a fresh document and waits for PUT acknowledgement', async () => {
    let acknowledge!: (value: Response) => void;
    fetchMock.mockResolvedValueOnce(response({ app: { theme: 'dark' }, other: 1 }));
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve; }));
    const write = platform.createStore('settings.json').set('app', { theme: 'light' });
    let settled = false;
    void write.then(() => { settled = true; });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('http://127.0.0.1:8790/api/v1/settings');
    expect(init?.headers).toEqual({ Authorization: 'Bearer secret', 'content-type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toEqual({ app: { theme: 'light' }, other: 1 });
    acknowledge(response({ ok: true }));
    await write;
    expect(settled).toBe(true);
  });

  it('serializes writes across store instances and snapshots queued values', async () => {
    let acknowledge!: (value: Response) => void;
    fetchMock.mockResolvedValueOnce(response({}));
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve; }));
    fetchMock.mockResolvedValueOnce(response({ app: { showOnboarding: true } }));
    fetchMock.mockResolvedValueOnce(response({ ok: true }));
    const first = platform.createStore('settings.json').set('app', { showOnboarding: true });
    const value = { showOnboarding: false };
    const second = platform.createStore('settings.json').set('app', value);
    value.showOnboarding = true;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    acknowledge(response({ ok: true }));
    await Promise.all([first, second]);
    expect(JSON.parse(fetchMock.mock.calls[3][1]?.body as string)).toEqual({ app: { showOnboarding: false } });
  });

  it('rejects failed reads without writing, and can retry a failed write', async () => {
    const store = platform.createStore('settings.json');
    fetchMock.mockResolvedValueOnce(response({}, 500));
    await expect(store.set('app', {})).rejects.toThrow(/HTTP 500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response({}));
    fetchMock.mockResolvedValueOnce(response({}, 503));
    await expect(store.set('app', {})).rejects.toThrow(/HTTP 503/);
    fetchMock.mockResolvedValueOnce(response({}));
    fetchMock.mockResolvedValueOnce(response({ ok: true }));
    await expect(store.set('app', {})).resolves.toBeUndefined();
  });

  it('rejects invalid documents and missing connections', async () => {
    const store = platform.createStore('settings.json');
    fetchMock.mockResolvedValueOnce(response([]));
    await expect(store.get('app')).rejects.toThrow(/not a JSON object/);
    connection.current = null;
    await expect(store.get('app')).rejects.toThrow(/Backend unavailable/);
  });

  it('does not send queued edits to a replacement connection', async () => {
    let finishRead!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    const store = platform.createStore('settings.json');
    const first = store.get('app');
    const second = store.set('app', { showOnboarding: false });
    const rejected = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    connection.current = { base: 'http://127.0.0.1:9900', token: 'new-token' };
    finishRead(response({}));
    expect((await rejected).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response({ app: 1 }));
    await expect(store.get('app')).resolves.toBe(1);
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:9900/api/v1/settings');
  });
});
