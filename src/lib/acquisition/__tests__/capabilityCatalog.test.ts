import { afterEach, describe, expect, it } from 'vitest';
import { tauriMock } from '../../../test/setup';
import { useModelCatalogStore } from '../../../store/modelCatalogStore';
import { loadAdapterCapabilities, resetCapabilityCatalogForTests } from '../capabilityCatalog';

describe('capability catalog cache', () => {
  afterEach(() => {
    resetCapabilityCatalogForTests();
    useModelCatalogStore.setState({ generation: 0 });
    tauriMock.invoke.mockReset();
    tauriMock.invoke.mockResolvedValue(undefined);
  });

  it('deduplicates concurrent loads and refreshes explicitly', async () => {
    tauriMock.invoke.mockResolvedValue([] as unknown);
    const [left, right] = await Promise.all([
      loadAdapterCapabilities(),
      loadAdapterCapabilities(),
    ]);
    expect(left).toEqual([]);
    expect(right).toEqual([]);
    expect(tauriMock.invoke).toHaveBeenCalledTimes(1);
    expect(tauriMock.invoke).toHaveBeenCalledWith('list_adapter_capabilities');

    await loadAdapterCapabilities(true);
    expect(tauriMock.invoke).toHaveBeenCalledTimes(2);
  });

  it('does not permanently cache failures', async () => {
    tauriMock.invoke
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([] as unknown);
    await expect(loadAdapterCapabilities()).rejects.toThrow('offline');
    await expect(loadAdapterCapabilities()).resolves.toEqual([]);
    expect(tauriMock.invoke).toHaveBeenCalledTimes(2);
  });

  it('isolates cache per connection generation', async () => {
    tauriMock.invoke.mockResolvedValue([{ adapterId: 'serial' }] as unknown);
    await loadAdapterCapabilities();
    expect(tauriMock.invoke).toHaveBeenCalledTimes(1);

    // 新连接代际 (configure/disconnect): 旧 Promise 不复用, 重新发现设备
    useModelCatalogStore.getState().bumpGeneration();
    const second = await loadAdapterCapabilities();
    expect(tauriMock.invoke).toHaveBeenCalledTimes(2);
    expect(second).toEqual([{ adapterId: 'serial' }]);
  });

  it('refetches after a failed request when the generation changed', async () => {
    tauriMock.invoke
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ adapterId: 'tcp' }] as unknown);
    await expect(loadAdapterCapabilities()).rejects.toThrow('offline');
    useModelCatalogStore.getState().bumpGeneration();
    await expect(loadAdapterCapabilities()).resolves.toEqual([{ adapterId: 'tcp' }]);
    expect(tauriMock.invoke).toHaveBeenCalledTimes(2);
  });
});
