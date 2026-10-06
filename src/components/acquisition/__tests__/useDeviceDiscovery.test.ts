import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/tauri/tauri', () => ({
  api: { discoverAcquisitionEndpoints: vi.fn() },
  formatError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const { useDeviceDiscovery } = await import('../useDeviceDiscovery');
const { api } = await import('../../../lib/tauri/tauri');

const card = (id: string) => ({
  adapter: { adapterId: id, displayName: id, operations: { discover: {} } },
  endpoint: { status: { state: 'available' } },
});
/// 形状残缺的卡片: `refresh` 读 `adapter.operations.discover` 时会同步抛错
const brokenCard = () => ({
  adapter: { adapterId: 'a', displayName: 'a' },
  endpoint: { status: { state: 'available' } },
});

const asCards = (v: unknown[]): never => v as never;

/// 卡片数组必须是稳定引用, 否则 `refresh` 的 useCallback 依赖每次渲染都变, 会自激。
/// 这里全部提到模块级 —— 写在 renderHook 回调里等于每帧新建一个数组。
const CARDS = asCards([card('a')]);
const BROKEN_CARDS = asCards([brokenCard()]);
const NO_CARDS = asCards([]);

describe('useDeviceDiscovery', () => {
  it('成功时填入发现结果并收尾', async () => {
    vi.mocked(api.discoverAcquisitionEndpoints).mockResolvedValue([
      { id: 'e1' },
    ] as never);
    const { result } = renderHook(() => useDeviceDiscovery(CARDS));
    await waitFor(() => {
      expect(result.current.pending).toBe(false);
    });
    expect(result.current.discoveries).toEqual({ a: [{ id: 'e1' }] });
    expect(result.current.errors).toEqual([]);
  });

  it('适配器失败时记进 errors 并收尾 — 单点失败不该拖住整个面板', async () => {
    vi.mocked(api.discoverAcquisitionEndpoints).mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useDeviceDiscovery(CARDS));
    await waitFor(() => {
      expect(result.current.pending).toBe(false);
    });
    expect(result.current.errors).toEqual(['a: nope']);
  });

  it('同步抛错也必须收尾 — 否则发现按钮永远停在转圈上', async () => {
    // 这是修复的那个缺陷: 原实现在 `await` 之前就可能抛 (卡片形状意外、字段缺失),
    // 于是 `setPending(true)` 之后再没人把它放回 false, 界面既不结束也不报错。
    vi.mocked(api.discoverAcquisitionEndpoints).mockResolvedValue([] as never);
    const { result } = renderHook(() => useDeviceDiscovery(BROKEN_CARDS));
    await waitFor(() => {
      expect(result.current.pending, '同步抛错后必须落回空闲').toBe(false);
    });
    expect(result.current.errors.length, '失败原因要让用户看见').toBeGreaterThan(0);
  });

  it('没有可发现适配器时不报错, 直接收尾', async () => {
    const spy = vi.mocked(api.discoverAcquisitionEndpoints);
    spy.mockClear();
    const { result } = renderHook(() => useDeviceDiscovery(NO_CARDS));
    await waitFor(() => {
      expect(result.current.pending).toBe(false);
    });
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.errors).toEqual([]);
  });

  it('被取代的旧请求不得覆盖新请求的结果, 也不得提前清掉忙碌状态', async () => {
    // 先挂住第一个请求, 再发起第二个。旧请求迟到时必须被 `generation` 拦掉。
    const resolvers: ((v: unknown[]) => void)[] = [];
    vi.mocked(api.discoverAcquisitionEndpoints).mockImplementation(
      () => new Promise((res) => { resolvers.push(res); }) as never,
    );

    const cards = asCards([card('a')]);
    const { result, rerender } = renderHook(({ c }) => useDeviceDiscovery(c), {
      initialProps: { c: cards },
    });
    await waitFor(() => {
      expect(result.current.pending).toBe(true);
    });

    // 换一份新数组触发重跑 (新身份 => 新 refresh)
    const cards2 = asCards([card('b')]);
    rerender({ c: cards2 });
    await waitFor(() => {
      expect(resolvers.length).toBeGreaterThanOrEqual(2);
    });

    // 第二个请求先落地
    resolvers[1]([{ id: 'fresh' }]);
    await waitFor(() => {
      expect(result.current.pending).toBe(false);
    });

    // 第一个请求此刻才落地: 不得改写结果, 也不得重新点亮忙碌
    resolvers[0]([{ id: 'stale' }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.discoveries).toEqual({ b: [{ id: 'fresh' }] });
    expect(result.current.pending).toBe(false);
  });

  it('旧请求在新请求仍在飞时落地, 不得把忙碌状态提前清掉', async () => {
    // 上一条用例里旧请求落地时新请求已经收尾, 于是"清 pending"成了空操作,
    // 分不出收尾有没有做 `generation` 判断。这里把顺序倒过来: 旧请求先落地。
    const resolvers: ((v: unknown[]) => void)[] = [];
    vi.mocked(api.discoverAcquisitionEndpoints).mockImplementation(
      () => new Promise((res) => { resolvers.push(res); }) as never,
    );

    const cards = asCards([card('a')]);
    const { result, rerender } = renderHook(({ c }) => useDeviceDiscovery(c), {
      initialProps: { c: cards },
    });
    await waitFor(() => {
      expect(result.current.pending).toBe(true);
    });

    const cards2 = asCards([card('b')]);
    rerender({ c: cards2 });
    await waitFor(() => {
      expect(resolvers.length).toBeGreaterThanOrEqual(2);
    });

    // 旧请求先落地: 新请求还在飞, 界面必须继续显示忙碌
    resolvers[0]([{ id: 'stale' }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.pending, '新请求还在飞, 忙碌状态不能被旧请求清掉').toBe(true);

    resolvers[1]([{ id: 'fresh' }]);
    await waitFor(() => {
      expect(result.current.pending).toBe(false);
    });
    expect(result.current.discoveries).toEqual({ b: [{ id: 'fresh' }] });
  });
});
