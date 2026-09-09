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
import { createWidget } from '../../lib/utils/widgetDefaults';
import { resetCapabilityCatalogForTests } from '../../lib/acquisition/capabilityCatalog';
import type { AdapterCapability } from '../../types';

const initialDock = structuredClone({ root: useDockStore.getState().root, cards: useDockStore.getState().cards });
const serial: AdapterCapability = {
  adapterId: 'serial', displayName: 'Serial', contractVersion: 1, transport: 'serial', protocol: 'raw', direction: 'peer',
  operations: { byteSource: true, byteSink: true, discover: true, browse: false, read: false, subscribe: false, write: false, method: false },
  dataDomains: ['bytes'], endpoints: [{
    id: 'device', displayName: 'Serial', transport: 'serial', direction: 'peer', status: { state: 'available' },
    ports: [{ id: 'rx', displayName: 'RX', direction: 'output', dataDomain: 'bytes', operations: { byteSource: true, byteSink: false, discover: false, browse: false, read: false, subscribe: false, write: false, method: false }, dataTypes: [] }],
    configuration: { schemaVersion: 1, jsonSchema: { type: 'object', properties: { baud_rate: { type: 'integer', default: 115200 } } }, uiHints: {} },
  }],
};

beforeEach(() => {
  resetCapabilityCatalogForTests();
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
afterEach(() => vi.restoreAllMocks());

function addRaw() {
  const raw = createWidget('RawData');
  useAppStore.getState().addWidget(raw, 'default', { x: 560, y: 120 });
  return raw.params.id;
}

it('seeds Serial → JustFloat → RawData, opens raw below and selects Serial for upper-right properties', async () => {
  const rawId = addRaw();
  await useAppStore.getState().seedInitialGraph(rawId);
  const state = useAppStore.getState();
  expect(state.rfNodes).toHaveLength(3);
  const device = state.rfNodes.find(n => n.type === 'acquisition')!;
  const protocol = state.rfNodes.find(n => n.type === 'protocol')!;
  expect(device.selected).toBe(true);
  expect(device.data.spec).toMatchObject({ driver: { driverId: 'serial', payload: { baud_rate: 115200 } } });
  expect(device.data.spec).not.toHaveProperty('simulation');
  expect(protocol.data.config).toMatchObject({ kind: 'JustFloat' });
  expect(state.rfEdges).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: device.id, target: protocol.id }),
    expect.objectContaining({ source: protocol.id, target: rawId }),
  ]));
  expect(useDockStore.getState().cards['data-main'].activeTabId).toBe(rawId);
  expect(useDockStore.getState().cards['properties-main'].activeTabId).toBe('node-properties-fixed');
  expect(useDockStore.getState().root).toEqual(initialDock.root);
  await state.seedInitialGraph(rawId);
  expect(useAppStore.getState().rfNodes).toHaveLength(3);
});

it('does not seed over a restored workspace', async () => {
  const rawId = addRaw();
  useAppStore.setState({ workspaceRestored: true });
  await useAppStore.getState().seedInitialGraph(rawId);
  expect(useAppStore.getState().rfNodes).toHaveLength(1);
});

it('adds a default canvas from a restored workspace without changing existing nodes', async () => {
  const oldRawId = addRaw();
  useAppStore.setState({ workspaceRestored: true });
  await useAppStore.getState().addDefaultCanvas();
  const state = useAppStore.getState();
  expect(state.controlTabs).toHaveLength(2);
  expect(state.rfNodes.find(node => node.id === oldRawId)?.data.tabId).toBe('default');
  expect(state.rfNodes.filter(node => node.data.tabId === state.activeControlTabId)).toHaveLength(3);
  expect(state.rfNodes.find(node => node.selected)?.type).toBe('acquisition');
  expect(useDockStore.getState().cards['control-main'].activeTabId).toBe(state.activeControlTabId);
  const raw = state.dataTabs.find(tab => tab.type === 'raw' && tab.id !== oldRawId)!;
  expect(useDockStore.getState().cards['data-main'].activeTabId).toBe(raw.id);
});
