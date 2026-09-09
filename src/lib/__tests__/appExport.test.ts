import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.hoisted(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    },
  });
});
import { applySnapshot, collectPartialSnapshot, detectPresentSections, parseSnapshot, serializeSnapshot, type AppSnapshot } from '../tauri/appExport';
import { useAppStore } from '../../store/appStore';
import { tauriMock } from '../../test/setup';
import { deviceDocument, protocolDocument } from '../../test/nodeDocuments';

function snapshot(): AppSnapshot {
  return {
    version: 4, exportedAt: '', sections: ['workspace'],
    workspace: {
      tabs: [{ id: 'default', name: 'Tab 1' }],
      graphs: [{ tab_id: 'default', documents: [deviceDocument(), protocolDocument()],
        edges: [{ id: 'wire', source: 'device', source_handle: 'rx', target: 'parser', target_handle: 'in' }] }],
      dataTabs: [], activeDataTabId: '', activeControlTabId: 'default', rawDataViewPrefs: {},
    },
  };
}

describe('atomic workspace export', () => {
  afterEach(() => useAppStore.setState({ rfNodes: [], rfEdges: [] } as never));

  it('exports the workspace as one indivisible document section', () => {
    const part = collectPartialSnapshot(['workspace', 'windowLayout']);
    expect(part.sections).toEqual(['workspace', 'windowLayout']);
    expect(part.workspace).toBeDefined();
    expect(part.settings).toBeUndefined();
    expect(part.dockRoot).toBeDefined();
  });

  it('round-trips only the new document contract', () => {
    const parsed = parseSnapshot(serializeSnapshot(snapshot()));
    expect(parsed.version).toBe(4);
    expect(parsed.workspace?.graphs[0].documents).toHaveLength(2);
    expect(detectPresentSections(parsed)).toEqual(['workspace']);
  });

  it('rejects old, empty, cross-tab and dangling documents', () => {
    expect(() => parseSnapshot('{oops')).toThrow();
    expect(() => parseSnapshot(JSON.stringify({ version: 3, rfNodes: [] }))).toThrow(/不支持/);
    expect(() => parseSnapshot(JSON.stringify({ version: 4 }))).toThrow(/为空/);
    const invalid = snapshot();
    invalid.workspace!.graphs[0].documents[0].tabId = 'elsewhere';
    expect(() => parseSnapshot(serializeSnapshot(invalid))).toThrow(/页签/);
    const dangling = snapshot();
    dangling.workspace!.graphs[0].edges[0].target = 'missing';
    expect(() => parseSnapshot(serializeSnapshot(dangling))).toThrow(/悬空/);
  });

  it('restore closes devices, replaces documents and never reconnects', async () => {
    tauriMock.invoke.mockClear();
    useAppStore.setState({
      controlTabs: [{ id: 'old', name: 'Old' }], activeControlTabId: 'old',
      rfNodes: [{ id: 'old-device', type: 'acquisition', position: { x: 0, y: 0 }, data: { tabId: 'old' } }],
      rfEdges: [],
    } as never);
    await applySnapshot(snapshot(), { sections: ['workspace'] });
    expect(tauriMock.invoke).toHaveBeenCalledWith('close_transport', { nodeId: 'old-device' });
    expect(tauriMock.invoke).toHaveBeenCalledWith('remove_tab_graph', { tabId: 'old' });
    expect(tauriMock.invoke).not.toHaveBeenCalledWith('open_acquisition_endpoint', expect.anything());
    expect(useAppStore.getState().rfNodes.map(node => node.id)).toEqual(['device', 'parser']);
  });

  it('does not remove a retained tab', async () => {
    tauriMock.invoke.mockClear();
    useAppStore.setState({ controlTabs: [{ id: 'default', name: 'Tab 1' }] } as never);
    await applySnapshot(snapshot(), { sections: ['workspace'] });
    expect((tauriMock.invoke.mock.calls as unknown as [string, unknown][]).some(([command]) => command === 'remove_tab_graph')).toBe(false);
  });
});
