import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAsyncAction } from '../useAsyncAction';

/// 一个可外部决定何时兑现的 promise, 用来稳定地制造并发交错。
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAsyncAction', () => {
  it('忙碌期间 busy 为真, 完成后落回', async () => {
    const onError = vi.fn();
    const d = deferred<string>();
    const { result } = renderHook(() => useAsyncAction({ onError }));

    expect(result.current.busy).toBe(false);
    let done: Promise<string | undefined> | undefined;
    act(() => {
      done = result.current.run('label', () => d.promise);
    });
    await waitFor(() => {
      expect(result.current.busy).toBe(true);
    });

    d.resolve('ok');
    await act(async () => {
      await done;
    });
    expect(result.current.busy).toBe(false);
  });

  it('成功时把结果原样交回, 且不调用 onError', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useAsyncAction({ onError }));
    let value: number | undefined;
    await act(async () => {
      value = await result.current.run('label', () => Promise.resolve(42));
    });
    expect(value).toBe(42);
    expect(onError).not.toHaveBeenCalled();
  });

  it('失败时不抛异常, 而是上报 — 否则调用点的 void run() 会变成未处理 rejection', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useAsyncAction({ onError }));
    const boom = new Error('boom');
    let value: unknown = 'sentinel';
    await act(async () => {
      value = await result.current.run('recordingDatabaseCreateFailed', () => Promise.reject(boom));
    });
    expect(value).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(boom, 'recordingDatabaseCreateFailed');
  });

  it('失败后 busy 也要落回', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useAsyncAction({ onError }));
    await act(async () => {
      await result.current.run('label', () => Promise.reject(new Error('boom')));
    });
    expect(result.current.busy).toBe(false);
  });

  it('并发时先完成的那个不得清掉忙碌状态 — 用计数而非布尔', async () => {
    const onError = vi.fn();
    const first = deferred<void>();
    const second = deferred<void>();
    const { result } = renderHook(() => useAsyncAction({ onError }));

    act(() => {
      void result.current.run('a', () => first.promise);
      void result.current.run('b', () => second.promise);
    });
    await waitFor(() => {
      expect(result.current.busy).toBe(true);
    });

    // 只完成第一个: 布尔实现会在这里误判为空闲
    await act(async () => {
      first.resolve();
      await first.promise;
    });
    expect(result.current.busy, '还有第二个在飞, 不能算空闲').toBe(true);

    await act(async () => {
      second.resolve();
      await second.promise;
    });
    expect(result.current.busy).toBe(false);
  });

  it('卸载后不再上报 — 用户已经看不到这个面板了', async () => {
    const onError = vi.fn();
    const d = deferred<void>();
    const { result, unmount } = renderHook(() => useAsyncAction({ onError }));

    act(() => {
      void result.current.run('label', () => d.promise);
    });
    unmount();
    await act(async () => {
      d.reject(new Error('late failure'));
      await d.promise.catch(() => undefined);
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('卸载后迟到的完成不再写状态 — 否则 React 会报卸载后更新', async () => {
    const onError = vi.fn();
    const d = deferred<void>();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => useAsyncAction({ onError }));

    act(() => {
      void result.current.run('label', () => d.promise);
    });
    unmount();
    await act(async () => {
      d.resolve();
      await d.promise;
    });
    const calls = spy.mock.calls.map((c) => String(c[0]));
    expect(calls.filter((c) => c.includes('unmounted')), '不应有卸载后更新告警').toHaveLength(0);
    spy.mockRestore();
    expect(onError).not.toHaveBeenCalled();
  });

  it('onError 换新函数后仍然调用最新那个', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ onError }) => useAsyncAction({ onError }), {
      initialProps: { onError: first },
    });
    rerender({ onError: second });
    await act(async () => {
      await result.current.run('label', () => Promise.reject(new Error('boom')));
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('run 的身份保持稳定 — 换 onError 不该让它重建', () => {
    const { result, rerender } = renderHook(({ onError }) => useAsyncAction({ onError }), {
      initialProps: { onError: vi.fn() },
    });
    const before = result.current.run;
    rerender({ onError: vi.fn() });
    expect(result.current.run).toBe(before);
  });
});
