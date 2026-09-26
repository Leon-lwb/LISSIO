import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const store = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  const g = globalThis as { localStorage?: unknown };
  g.localStorage = localStorageMock;
});

import { useAppStore } from '../appStore';
import { useDockStore } from '../dockStore';
import { api } from '../../lib/tauri/tauri';
import { resetCapabilityCatalogForTests } from '../../lib/acquisition/capabilityCatalog';
import { resetModelCatalogForTests } from '../modelCatalogStore';
import { seedModelCatalogForTests, mockPrepareEcho } from '../../test/modelCatalog';
import { createNodeFromCatalog } from '../../lib/models/createFromCatalog';
import type { AdapterCapability } from '../../types';

const initialDock = structuredClone({ root: useDockStore.getState().root, cards: useDockStore.getState().cards });
const serial: AdapterCapability = {
  adapterId: 'serial', displayName: 'Serial', contractVersion: 1, transport: 'serial', protocol: 'raw', direction: 'peer',
  operations: { byteSource: true, byteSink: true, discover: true, browse: false, read: false, subscribe: false, write: false, method: false },
  dataDomains: ['bytes'], endpoints: [{
    id: 'device', displayName: 'Serial', transport: 'serial', direction: 'peer', status: { state: 'available', detail: null },
    ports: [{ id: 'rx', displayName: 'RX', direction: 'output', dataDomain: 'bytes', operations: { byteSource: true, byteSink: false, discover: false, browse: false, read: false, subscribe: false, write: false, method: false }, dataTypes: [], addressSpace: null, display: null }],
    configuration: { schemaVersion: 1, jsonSchema: { type: 'object', properties: { baud_rate: { type: 'integer', default: 115200 } } }, uiHints: null },
    display: null,
  }],
  display: null,
};

beforeEach(() => {
  resetCapabilityCatalogForTests();
  resetModelCatalogForTests();
  seedModelCatalogForTests();
  mockPrepareEcho();
  useAppStore.setState({ rfNodes: [], rfEdges: [], workspaceRestored: false,
    controlTabs: [{ id: 'default', name: 'Default' }], activeControlTabId: 'default',
    dataTabs: [
      { id: 'compile-errors-fixed', type: 'compile-errors', name: 'Errors', closable: false },
      { id: 'compile-results-fixed', type: 'compile-results', name: 'Results', closable: false },
      { id: 'node-properties-fixed', type: 'node-properties', name: 'Properties', closable: true },
    ],
  });
  useDockStore.setState(structuredClone(initialDock));
  vi.spyOn(api, 'listAdapterCapabilities').mockResolvedValue([serial]);
  vi.spyOn(useAppStore.getState(), 'syncTabGraph').mockResolvedValue(undefined);
});
afterEach(() => {
  resetModelCatalogForTests();
  vi.restoreAllMocks();
});

async function addRaw(): Promise<string> {
  // 与生产一致 — RawData 种子经目录创建服务 (prepare)
  const node = await createNodeFromCatalog({ modelId: 'widget:RawData', position: { x: 560, y: 120 }, tabId: 'default' });
  return node.id;
}

it('seeds Serial → JustFloat → RawData, opens raw below and selects Serial for upper-right properties', async () => {
  const rawId = await addRaw();
  await useAppStore.getState().seedInitialGraph(rawId);
  const state = useAppStore.getState();
  expect(state.rfNodes).toHaveLength(2);
  const device = state.rfNodes.find(n => n.type === 'acquisition')!;
  const protocol = (device.data.node as { children: { id: string; driver: string; config: { protocol: { kind: string } } }[] }).children[0];
  expect(device.selected).toBe(true);
  expect(device.data.node).toMatchObject({ driver: 'serial', config: { baud_rate: 115200 } });
  expect(protocol).toMatchObject({ driver: 'protocol-engine', config: { protocol: { kind: 'JustFloat' } } });
  expect(state.rfEdges).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: protocol.id, target: rawId }),
  ]));
  expect(useDockStore.getState().cards['data-main'].activeTabId).toBe(rawId);
  expect(useDockStore.getState().cards['properties-main'].activeTabId).toBe('node-properties-fixed');
  expect(useDockStore.getState().root).toEqual(initialDock.root);
  await state.seedInitialGraph(rawId);
  expect(useAppStore.getState().rfNodes).toHaveLength(2);
});

it('does not seed over a restored workspace', async () => {
  const rawId = await addRaw();
  useAppStore.setState({ workspaceRestored: true });
  await useAppStore.getState().seedInitialGraph(rawId);
  expect(useAppStore.getState().rfNodes).toHaveLength(1);
});

it('adds a default canvas from a restored workspace without changing existing nodes', async () => {
  const oldRawId = await addRaw();
  useAppStore.setState({ workspaceRestored: true });
  await useAppStore.getState().addDefaultCanvas();
  const state = useAppStore.getState();
  expect(state.controlTabs).toHaveLength(2);
  expect(state.rfNodes.find(node => node.id === oldRawId)?.data.tabId).toBe('default');
  expect(state.rfNodes.filter(node => node.data.tabId === state.activeControlTabId)).toHaveLength(2);
  expect(state.rfNodes.find(node => node.selected)?.type).toBe('acquisition');
  expect(useDockStore.getState().cards['control-main'].activeTabId).toBe(state.activeControlTabId);
  const raw = state.dataTabs.find(tab => tab.type === 'raw' && tab.id !== oldRawId)!;
  expect(useDockStore.getState().cards['data-main'].activeTabId).toBe(raw.id);
});
