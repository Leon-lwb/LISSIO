import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMock } from '../../../test/setup';
import { tauriTransport } from '../tauriTransport';

const invokeMock = tauriMock.invoke as unknown as ReturnType<typeof vi.fn>;

function callsTo(cmd: string): unknown[][] {
  return (invokeMock.mock.calls as unknown[][]).filter((call) => call[0] === cmd);
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  tauriMock.listen.mockReset();
});

describe('tauriTransport 命令通道', () => {
  it('无参命令保持 invoke(cmd) 的调用形状', async () => {
    await tauriTransport.call('list_ports');
    expect(invokeMock).toHaveBeenCalledWith('list_ports');
  });

  it('带参命令原样透传 camelCase 参数', async () => {
    await tauriTransport.call('send_raw', { nodeId: 'n1', data: [1] });
    expect(invokeMock).toHaveBeenCalledWith('send_raw', { nodeId: 'n1', data: [1] });
  });
});

describe('tauriTransport 事件通道', () => {
  it('listen 解包事件的 payload', async () => {
    let captured: ((event: { payload: unknown }) => void) | null = null;
    const listenMock = tauriMock.listen as unknown as {
      mockImplementation: (
        impl: (
          event: string,
          callback: (event: { payload: unknown }) => void,
        ) => Promise<() => void>,
      ) => void;
    };
    listenMock.mockImplementation((_event, callback) => {
      captured = callback;
      return Promise.resolve((): void => undefined);
    });
    const handler = vi.fn();
    await tauriTransport.listen<{ node_id: string }>('transport:state', handler);
    expect(captured).not.toBeNull();
    (captured as unknown as (event: { payload: unknown }) => void)({
      payload: { node_id: 'n1' },
    });
    expect(handler).toHaveBeenCalledWith({ node_id: 'n1' });
  });
});

describe('tauriTransport 显示订阅', () => {
  it('subscribe_data 带上 onEvent 通道与节流参数', () => {
    tauriTransport.subscribe({ kind: 'spectrum' }, () => undefined, {
      intervalMs: 33,
      maxItems: 200,
      onError: () => undefined,
    });
    const calls = callsTo('subscribe_data');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({
      request: { kind: 'spectrum' },
      intervalMs: 33,
      maxItems: 200,
    });
    expect(calls[0][1]).toHaveProperty('onEvent');
  });

  it('通道 id 立即可读 — 背压反馈不依赖建立完成', () => {
    const subscription = tauriTransport.subscribe({ kind: 'port_samples' }, () => undefined);
    expect(subscription.id).not.toBeNull();
  });

  it('建立期间取消会在 invoke 落地后补一次注销 (覆盖竞态)', async () => {
    const subscription = tauriTransport.subscribe({ kind: 'waveform' }, () => undefined);
    subscription.cancel();
    await Promise.resolve();
    expect(callsTo('unsubscribe_data')).toHaveLength(2);
  });

  it('建立失败只经 onError 上报, settled 不拒绝', async () => {
    invokeMock.mockRejectedValueOnce({ kind: 'Transport', message: '订阅失败' });
    const onError = vi.fn();
    const subscription = tauriTransport.subscribe({ kind: 'waveform' }, () => undefined, {
      onError,
    });
    await expect(subscription.settled).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith({ kind: 'Transport', message: '订阅失败' });
  });
});
