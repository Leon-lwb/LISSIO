import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { tauriMock } from '../../test/setup';
import { useAppStore } from '../appStore';

/// 手工 rAF ticker — 与 eventsBatching.test.ts 同款: 让 events.ts 的帧级合批确定。
function installManualRaf() {
  const origRaf = globalThis.requestAnimationFrame;
  const origCaf = globalThis.cancelAnimationFrame;
  let queued: { id: number; cb: FrameRequestCallback }[] = [];
  let nextId = 1;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const id = nextId++;
    queued.push({ id, cb });
    return id;
  });
  globalThis.cancelAnimationFrame = ((id: number) => {
    queued = queued.filter((q) => q.id !== id);
  });
  const flush = () => {
    const items = queued.splice(0);
    for (const { cb } of items) cb(0);
  };
  return {
    flush,
    restore: () => {
      globalThis.requestAnimationFrame = origRaf;
      globalThis.cancelAnimationFrame = origCaf;
    },
  };
}

type SubscribeCall = [
  string,
  { request?: { kind?: string }; onEvent?: { onmessage: ((msg: unknown) => void) | null } },
];

/// 取出 initEventListeners 注册的 string_outputs 订阅通道。
function stringOutputsChannel() {
  const calls = tauriMock.invoke.mock.calls as unknown as SubscribeCall[];
  const call = calls.find(
    (c) => c[0] === 'subscribe_data' && c[1].request?.kind === 'string_outputs'
  );
  const channel = call?.[1]?.onEvent;
  if (!channel) throw new Error('string_outputs channel not registered');
  return (values: Record<string, Record<string, string>>) =>
    channel.onmessage?.({ kind: 'string_outputs', payload: { tick: 1, values } });
}

let ticker: ReturnType<typeof installManualRaf>;
let cleanup: () => void;

beforeEach(async () => {
  ticker = installManualRaf();
  cleanup = await useAppStore.getState().initEventListeners();
});

afterEach(() => {
  cleanup();
  ticker.restore();
  tauriMock.invoke.mockClear();
});

describe('customTextOutputs frame guard', () => {
  it('skips the store write and its subscribers when the snapshot is equivalent', () => {
    const push = stringOutputsChannel();
    const listener = vi.fn();
    const unsubscribe = useAppStore.subscribe(listener);

    act(() => push({ widgetA: { text: 'hello' } }));
    act(() => ticker.flush());
    const first = useAppStore.getState().customTextOutputs;
    expect(first).toEqual({ widgetA: { text: 'hello' } });
    const writesAfterFirstFrame = listener.mock.calls.length;
    expect(writesAfterFirstFrame).toBeGreaterThan(0);

    // 等价快照 (每帧重建对象, 身份不同但逐键文本相同) → 不 set
    act(() => push({ widgetA: { text: 'hello' } }));
    act(() => ticker.flush());
    expect(useAppStore.getState().customTextOutputs).toBe(first);
    expect(listener.mock.calls.length).toBe(writesAfterFirstFrame);

    // 文本真正变化 → 仍写入 (语义不变)
    act(() => push({ widgetA: { text: 'world' } }));
    act(() => ticker.flush());
    expect(useAppStore.getState().customTextOutputs).not.toBe(first);
    expect(useAppStore.getState().customTextOutputs.widgetA.text).toBe('world');
    expect(listener.mock.calls.length).toBeGreaterThan(writesAfterFirstFrame);

    unsubscribe();
  });
});

describe('tab-meta listener short-circuit', () => {
  it('does not serialize the tab tables when neither slice identity changed', () => {
    const stringify = vi.spyOn(JSON, 'stringify');
    /// 监听器只对 `[controlTabs, dataTabs]` 这种数组参数序列化 — 以此计量。
    const tabSerializations = () =>
      stringify.mock.calls.filter(([value]) => Array.isArray(value)).length;
    stringify.mockClear();

    // 无关切片通知 (两个 tab 切片引用不变) → 序列化前短路, 0 次
    act(() => {
      useAppStore.setState({ runState: useAppStore.getState().runState });
    });
    expect(tabSerializations()).toBe(0);

    // 切片真正变化 → 仍走原 key 比较路径 (至少序列化一次)
    act(() => {
      useAppStore.setState({
        controlTabs: [...useAppStore.getState().controlTabs, { id: 'extra', name: 'Extra' }],
      });
    });
    expect(tabSerializations()).toBeGreaterThan(0);

    stringify.mockRestore();
  });
});
