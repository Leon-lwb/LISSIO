import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/// 内层订阅记录 — 断言取消/重订行为
interface CreatedSubscription {
  request: unknown;
  sink: (value: unknown) => void;
  cancel: ReturnType<typeof vi.fn>;
}

const created = vi.hoisted(() => ({ items: [] as CreatedSubscription[] }));

vi.mock('../index', () => ({
  transport: {
    subscribe: (request: unknown, sink: (value: unknown) => void) => {
      const cancel = vi.fn();
      created.items.push({ request, sink, cancel });
      return { id: created.items.length, settled: Promise.resolve(), cancel };
    },
  },
}));

import {
  isDisplayPushSuspended,
  setDisplayPushSuspended,
  subscribeDisplayTransport,
} from '../livePushGate';

describe('livePushGate 显示推送门', () => {
  beforeEach(() => {
    created.items.length = 0;
    setDisplayPushSuspended(false);
  });

  afterEach(() => {
    setDisplayPushSuspended(false);
  });

  it('未冻结时立即建立订阅, cancel 透传到内层', () => {
    const handle = subscribeDisplayTransport<number>({ kind: 'waveform' }, vi.fn());
    expect(created.items).toHaveLength(1);
    expect(handle.id).toBe(1);

    handle.cancel();
    expect(created.items[0].cancel).toHaveBeenCalledTimes(1);
  });

  it('暂停取消订阅, 恢复按原请求重订阅', () => {
    const sink = vi.fn();
    const handle = subscribeDisplayTransport<number>({ kind: 'spectrum' }, sink);
    expect(created.items).toHaveLength(1);

    setDisplayPushSuspended(true);
    expect(isDisplayPushSuspended()).toBe(true);
    expect(created.items[0].cancel).toHaveBeenCalledTimes(1);
    expect(handle.id).toBeNull();

    setDisplayPushSuspended(false);
    expect(created.items).toHaveLength(2);
    expect(created.items[1].request).toEqual({ kind: 'spectrum' });
    created.items[1].sink(2);
    expect(sink).toHaveBeenLastCalledWith(2);

    handle.cancel();
    expect(created.items[1].cancel).toHaveBeenCalledTimes(1);
  });

  it('冻结期间建立的订阅延后到恢复; 冻结期间取消的不再重订', () => {
    setDisplayPushSuspended(true);
    const delayed = subscribeDisplayTransport<number>({ kind: 'raw_data' }, vi.fn());
    const dropped = subscribeDisplayTransport<number>({ kind: 'can_frames' }, vi.fn());
    expect(created.items).toHaveLength(0);
    expect(delayed.id).toBeNull();

    dropped.cancel();

    setDisplayPushSuspended(false);
    expect(created.items).toHaveLength(1);
    expect(created.items[0].request).toEqual({ kind: 'raw_data' });

    delayed.cancel();
    expect(created.items[0].cancel).toHaveBeenCalledTimes(1);
  });

  it('重复设置同一冻结态不重复取消/重订', () => {
    const handle = subscribeDisplayTransport<number>({ kind: 'measurements' }, vi.fn());
    setDisplayPushSuspended(true);
    setDisplayPushSuspended(true);
    expect(created.items).toHaveLength(1);
    expect(created.items[0].cancel).toHaveBeenCalledTimes(1);
    setDisplayPushSuspended(false);
    setDisplayPushSuspended(false);
    expect(created.items).toHaveLength(2);
    handle.cancel();
  });
});
