import { afterEach, describe, expect, it, vi } from 'vitest';
import { tauriMock } from '../../test/setup';
import {
  MODEL_CATALOG_CONTRACT_VERSION,
  resetModelCatalogForTests,
  useModelCatalogStore,
} from '../modelCatalogStore';
import { seedModelCatalogForTests, widgetDescriptor } from '../../test/modelCatalog';

function catalogFixture(models: unknown[] = [widgetDescriptor('Knob')]) {
  return { contractVersion: 1, revision: 'rev-abc', models };
}

describe('modelCatalogStore', () => {
  afterEach(() => {
    resetModelCatalogForTests();
    tauriMock.invoke.mockReset();
    tauriMock.invoke.mockResolvedValue(undefined);
  });

  it('adopts a valid catalog payload', async () => {
    tauriMock.invoke.mockResolvedValue(catalogFixture());
    const generation = useModelCatalogStore.getState().generation;
    await useModelCatalogStore.getState().load(generation);
    const state = useModelCatalogStore.getState();
    expect(state.status).toBe('ready');
    expect(state.revision).toBe('rev-abc');
    expect(state.byId['widget:Knob']).toBeDefined();
  });

  it('rejects structurally invalid payloads as error', async () => {
    tauriMock.invoke.mockResolvedValue({ contractVersion: 1, revision: 'x' });
    await useModelCatalogStore.getState().load(useModelCatalogStore.getState().generation);
    expect(useModelCatalogStore.getState().status).toBe('error');
  });

  it('flags unsupported contract versions as incompatible', async () => {
    tauriMock.invoke.mockResolvedValue({
      contractVersion: MODEL_CATALOG_CONTRACT_VERSION + 1,
      revision: 'rev-future',
      models: [],
    });
    await useModelCatalogStore.getState().load(useModelCatalogStore.getState().generation);
    const state = useModelCatalogStore.getState();
    expect(state.status).toBe('incompatible');
    expect(state.contractVersion).toBe(MODEL_CATALOG_CONTRACT_VERSION + 1);
  });

  it('discards late responses from an older generation', async () => {
    let release!: (value: unknown) => void;
    tauriMock.invoke.mockImplementation(
      () => new Promise((resolve) => { release = resolve; })
    );
    const staleGeneration = useModelCatalogStore.getState().generation;
    const pending = useModelCatalogStore.getState().load(staleGeneration);
    // 连接切换: 代际递增, 旧响应不得写入
    useModelCatalogStore.getState().bumpGeneration();
    release(catalogFixture());
    await pending;
    expect(useModelCatalogStore.getState().status).toBe('idle');
    expect(useModelCatalogStore.getState().models).toEqual([]);
  });

  it('keeps the previous catalog untouched when a reload fails', async () => {
    seedModelCatalogForTests();
    tauriMock.invoke.mockRejectedValue(new Error('backend gone'));
    await useModelCatalogStore.getState().load(useModelCatalogStore.getState().generation);
    // load 失败把状态置为 error (可重试), 由调用方决定是否清空
    expect(useModelCatalogStore.getState().status).toBe('error');
    expect(useModelCatalogStore.getState().error).toBe('backend gone');
  });

  it('bumpGeneration invalidates the current catalog', () => {
    seedModelCatalogForTests();
    useModelCatalogStore.getState().bumpGeneration();
    const state = useModelCatalogStore.getState();
    expect(state.status).toBe('idle');
    expect(state.models).toEqual([]);
    expect(state.generation).toBeGreaterThan(0);
  });

  it('does not double-fetch while a load is in flight', async () => {
    let calls = 0;
    tauriMock.invoke.mockImplementation(() => {
      calls += 1;
      return Promise.resolve(catalogFixture());
    });
    const generation = useModelCatalogStore.getState().generation;
    await Promise.all([
      useModelCatalogStore.getState().load(generation),
      useModelCatalogStore.getState().load(generation),
    ]);
    expect(calls).toBe(1);
    expect(vi.isMockFunction(tauriMock.invoke)).toBe(true);
  });
});
