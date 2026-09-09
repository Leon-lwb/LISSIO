import { afterEach, describe, expect, it } from 'vitest';
import { tauriMock } from '../../../test/setup';
import { loadAdapterCapabilities, resetCapabilityCatalogForTests } from '../capabilityCatalog';

describe('capability catalog cache', () => {
  afterEach(() => {
    resetCapabilityCatalogForTests();
    tauriMock.invoke.mockReset();
    tauriMock.invoke.mockResolvedValue(undefined);
  });

  it('deduplicates concurrent loads and refreshes explicitly', async () => {
    tauriMock.invoke.mockResolvedValue([] as unknown as undefined);
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
      .mockResolvedValueOnce([] as unknown as undefined);
    await expect(loadAdapterCapabilities()).rejects.toThrow('offline');
    await expect(loadAdapterCapabilities()).resolves.toEqual([]);
    expect(tauriMock.invoke).toHaveBeenCalledTimes(2);
  });
});
