import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpTransport, type HttpTransport } from '../httpTransport';

/// 假 WebSocket — 由测试显式驱动 open / message / close, 并记录上行帧。
class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  readonly protocols: string[];
  readonly sent: string[] = [];

  constructor(url: string, protocols?: string[]) {
    this.url = url;
    this.protocols = protocols ?? [];
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  // ---- 测试驱动 ----
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  text(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  binary(bytes: number[]): void {
    const frame = new Uint8Array(bytes);
    this.onmessage?.({ data: frame.buffer });
  }

  frames(): Record<string, unknown>[] {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }
}

/// 拼装服务端二进制流帧 — `[version][format][u32 id][u32 len][payload]`
function binaryFrame(id: number, payload: number[]): number[] {
  const frame = new Uint8Array(10 + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint8(0, 1);
  view.setUint8(1, 1);
  view.setUint32(2, id, false);
  view.setUint32(6, payload.length, false);
  frame.set(payload, 10);
  return [...frame];
}

interface DisplayPayload {
  kind: string;
  payload: unknown;
}

let transport: HttpTransport;
let fetchMock: ReturnType<typeof vi.fn>;
/** 每个请求体 → 待返回的响应 (按调用顺序) */
let responses: unknown[];

function lastSocket(): FakeSocket {
  const socket = FakeSocket.instances[FakeSocket.instances.length - 1];
  if (!socket) throw new Error('连接尚未建立');
  return socket;
}

beforeEach(() => {
  FakeSocket.instances = [];
  responses = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  fetchMock = vi.fn(() => {
    const body = responses.shift() ?? { ok: true, result: null };
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(body),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  transport = createHttpTransport({ base: 'http://127.0.0.1:8790', token: 'secret' });
});

afterEach(() => {
  transport.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function rpcBodies(): unknown[][] {
  return fetchMock.mock.calls.map((call) => {
    const init = call[1] as { body: string };
    return JSON.parse(init.body) as unknown[];
  });
}

describe('HttpTransport 命令通道', () => {
  it('同一微任务内的命令合并为一次数组请求', async () => {
    responses.push([
      { id: 1, ok: true, result: 'A' },
      { id: 2, ok: true, result: 'B' },
    ]);
    const [a, b] = await Promise.all([
      transport.call<string>('workspace_get'),
      transport.call<string>('get_pipeline_config', { config: {} }),
    ]);
    expect([a, b]).toEqual(['A', 'B']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rpcBodies()[0]).toEqual([
      { id: 1, cmd: 'workspace_get', args: {} },
      { id: 2, cmd: 'get_pipeline_config', args: { config: {} } },
    ]);
  });

  it('单条命令也走数组形态, 且带 Bearer 令牌', async () => {
    responses.push([{ id: 1, ok: true, result: 7 }]);
    await expect(transport.call('get_can_load_stats', { nodeId: 'n1' })).resolves.toBe(7);
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.authorization).toBe('Bearer secret');
  });

  it('逐条映射失败响应, 不牵连同批次其他命令', async () => {
    responses.push([
      { id: 1, ok: true, result: 1 },
      { id: 2, ok: false, error: { kind: 'UnsupportedCommand', message: '没接入' } },
    ]);
    const first = transport.call('a');
    const second = transport.call('b');
    await expect(first).resolves.toBe(1);
    await expect(second).rejects.toEqual({
      kind: 'UnsupportedCommand',
      message: '没接入',
    });
  });

  it('非 2xx 响应把错误信封原样抛出 (401 鉴权失败)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ ok: false, error: { kind: 'Unauthorized', message: '缺少令牌' } }),
    });
    await expect(transport.call('workspace_get')).rejects.toEqual({
      kind: 'Unauthorized',
      message: '缺少令牌',
    });
  });

  it('响应数量与请求不符时报结构化错误, 而不是错配结果', async () => {
    responses.push([{ id: 1, ok: true, result: 1 }]);
    const first = transport.call('a');
    const second = transport.call('b');
    await expect(first).rejects.toMatchObject({ kind: 'InvalidResponse' });
    await expect(second).rejects.toMatchObject({ kind: 'InvalidResponse' });
  });
});

describe('HttpTransport 事件通道', () => {
  it('按事件名分发 payload, 注销后不再投递', async () => {
    const handler = vi.fn();
    // listen 会等待连接建立, 因此这里先发起再驱动 socket, 最后才 await
    const pending = transport.listen<{ node_id: string }>('transport:state', handler);
    const socket = lastSocket();
    socket.open();
    const unlisten = await pending;

    socket.text({ type: 'event', event: 'transport:state', payload: { node_id: 'n1' } });
    socket.text({ type: 'event', event: 'transport:rx', payload: { node_id: 'n1' } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ node_id: 'n1' });

    unlisten();
    socket.text({ type: 'event', event: 'transport:state', payload: { node_id: 'n2' } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('子协议同时携带协议名与令牌 (浏览器无法设置请求头)', async () => {
    const pending = transport.listen('transport:state', () => undefined);
    const socket = lastSocket();
    socket.open();
    await pending;
    expect(socket.protocols).toEqual(['lissio.v1', 'bearer.secret']);
    expect(socket.url).toBe('ws://127.0.0.1:8790/api/v1/ws');
  });
});

describe('HttpTransport 显示订阅', () => {
  it('订阅帧不含客户端 id, 回执下发 id 后即可分流流帧', () => {
    const sink = vi.fn();
    const subscription = transport.subscribe<DisplayPayload>({ kind: 'can_frames' }, sink);
    const socket = lastSocket();
    socket.open();

    expect(socket.frames()).toEqual([
      {
        type: 'subscribe',
        args: { request: { kind: 'can_frames' }, intervalMs: undefined, maxItems: undefined },
      },
    ]);
    expect(subscription.id).toBeNull();

    socket.text({ type: 'subscribed', id: 4 });
    expect(subscription.id).toBe(4);
    socket.text({ type: 'stream', id: 4, payload: { kind: 'can_frames', payload: { n: 1 } } });
    expect(sink).toHaveBeenCalledWith({ kind: 'can_frames', payload: { n: 1 } });
  });

  it('二进制流帧按 10 字节头部切开, payload 原样交给解码器', () => {
    const sink = vi.fn();
    transport.subscribe<ArrayBuffer>({ kind: 'waveform' }, sink);
    const socket = lastSocket();
    socket.open();
    socket.text({ type: 'subscribed', id: 2 });
    socket.binary(binaryFrame(2, [0xaa, 0xbb, 0xcc]));

    expect(sink).toHaveBeenCalledTimes(1);
    const payload = sink.mock.calls[0][0] as ArrayBuffer;
    expect(payload).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(payload)]).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it('未知订阅 id 的流帧被忽略 (不误投给其他订阅)', () => {
    const sink = vi.fn();
    transport.subscribe<DisplayPayload>({ kind: 'spectrum' }, sink);
    const socket = lastSocket();
    socket.open();
    socket.text({ type: 'subscribed', id: 5 });
    socket.text({ type: 'stream', id: 9, payload: { kind: 'spectrum', payload: {} } });
    socket.binary(binaryFrame(9, [1]));
    expect(sink).not.toHaveBeenCalled();
  });

  it('取消发生在回执之前时仍按顺序配对, 不会把回执错配给下一条订阅', () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = transport.subscribe<DisplayPayload>({ kind: 'can_frames' }, first);
    const b = transport.subscribe<DisplayPayload>({ kind: 'can_load' }, second);
    const socket = lastSocket();
    socket.open();
    expect(socket.frames().map((frame) => frame.type)).toEqual(['subscribe', 'subscribe']);

    a.cancel();
    socket.text({ type: 'subscribed', id: 11 });
    // a 已取消 → 立即注销; 记录留在队列里占位, 因此 12 仍然归 b
    expect(socket.frames()[socket.frames().length - 1]).toEqual({ type: 'unsubscribe', id: 11 });
    socket.text({ type: 'subscribed', id: 12 });
    expect(b.id).toBe(12);

    socket.text({ type: 'stream', id: 12, payload: { kind: 'can_load', payload: { n: 2 } } });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('取消已建立的订阅会发出 unsubscribe 并停止投递', () => {
    const sink = vi.fn();
    const subscription = transport.subscribe<DisplayPayload>({ kind: 'spectrum' }, sink);
    const socket = lastSocket();
    socket.open();
    socket.text({ type: 'subscribed', id: 3 });

    subscription.cancel();
    expect(socket.frames()[socket.frames().length - 1]).toEqual({ type: 'unsubscribe', id: 3 });
    socket.text({ type: 'stream', id: 3, payload: { kind: 'spectrum', payload: {} } });
    expect(sink).not.toHaveBeenCalled();
  });

  it('订阅建立失败带 id 上报, 只触发该订阅的 onError', () => {
    const onError = vi.fn();
    const other = vi.fn();
    transport.subscribe({ kind: 'port_samples' }, vi.fn(), { onError });
    transport.subscribe({ kind: 'spectrum' }, other, { onError: vi.fn() });
    const socket = lastSocket();
    socket.open();
    socket.text({ type: 'subscribed', id: 21 });
    socket.text({ type: 'subscribed', id: 22 });
    socket.text({ type: 'fault', id: 21, message: '端口不存在' });

    expect(onError).toHaveBeenCalledWith({ kind: 'SubscribeFailed', message: '端口不存在' });
    expect(other).not.toHaveBeenCalled();
  });

  it('无 id 的帧级错误只作日志, 不影响订阅', () => {
    const onError = vi.fn();
    const sink = vi.fn();
    transport.subscribe<DisplayPayload>({ kind: 'spectrum' }, sink, { onError });
    const socket = lastSocket();
    socket.open();
    socket.text({ type: 'subscribed', id: 31 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    socket.text({ type: 'fault', message: '帧解析失败' });

    expect(onError).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    socket.text({ type: 'stream', id: 31, payload: { kind: 'spectrum', payload: { n: 3 } } });
    expect(sink).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('断线重连后重新订阅活跃流并通知上层重新水合', async () => {
    vi.useFakeTimers();
    const onReconnect = vi.fn();
    transport.onReconnect(onReconnect);
    const sink = vi.fn();
    transport.subscribe<DisplayPayload>({ kind: 'can_frames' }, sink);
    const first = lastSocket();
    first.open();
    first.text({ type: 'subscribed', id: 41 });
    expect(onReconnect).not.toHaveBeenCalled();

    first.close();
    await vi.advanceTimersByTimeAsync(500);
    const second = lastSocket();
    expect(second).not.toBe(first);
    second.open();

    expect(second.frames()).toEqual([
      {
        type: 'subscribe',
        args: { request: { kind: 'can_frames' }, intervalMs: undefined, maxItems: undefined },
      },
    ]);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    // 重连后 id 重新分配, 流帧按新 id 继续投递
    second.text({ type: 'subscribed', id: 42 });
    second.text({ type: 'stream', id: 42, payload: { kind: 'can_frames', payload: { n: 4 } } });
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('取消后的订阅不会在重连时复活', async () => {
    vi.useFakeTimers();
    const subscription = transport.subscribe<DisplayPayload>({ kind: 'can_frames' }, vi.fn());
    const first = lastSocket();
    first.open();
    first.text({ type: 'subscribed', id: 51 });
    subscription.cancel();

    first.close();
    await vi.advanceTimersByTimeAsync(500);
    const second = lastSocket();
    second.open();
    expect(second.frames()).toEqual([]);
  });

  it('Web 出口未接入的通道在构造时抛出结构化错误', () => {
    expect(() => transport.eventChannel()).toThrowError(/ai_chat_send/);
    try {
      transport.eventChannel();
    } catch (error) {
      expect(error).toMatchObject({ kind: 'UnsupportedCommand' });
    }
  });
});
