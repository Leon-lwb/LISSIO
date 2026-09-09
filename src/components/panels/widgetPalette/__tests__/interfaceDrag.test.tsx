import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PaletteRow } from '../PaletteRow';
import type { PaletteEntry } from '../paletteModel';
import { dockDrag, __resetForTests } from '../../../../lib/dockDrag';
import { addPaletteNode } from '../../../../lib/utils/paletteCreation';
import { type AcquisitionNodeData } from '../../../../lib/acquisition/acquisitionNodes';
import { useAppStore } from '../../../../store/appStore';
import { useHistoryStore } from '../../../../store/historyStore';
import { hydrateWorkspaceFromBackend } from '../../../../store/appStoreHelpers';
import { tauriMock } from '../../../../test/setup';
import { nodeDocument } from '../../../../lib/nodes/document';
import { deviceDocument } from '../../../../test/nodeDocuments';
import { api } from '../../../../lib/tauri/tauri';
import { NodePropertiesPanel } from '../../../nodes/NodePropertiesPanel';
import { resetCapabilityCatalogForTests } from '../../../../lib/acquisition/capabilityCatalog';
import type { DeviceCardModel } from '../../../../lib/acquisition/deviceCardModel';


const operations = { byteSource: false, byteSink: false, discover: false, browse: false, read: true, subscribe: true, write: true, method: false };
const endpoint = {
  id: 'primary', displayName: 'Future endpoint', transport: 'future', direction: 'peer',
  status: { state: 'available' }, ports: [],
  configuration: { schemaVersion: 3, jsonSchema: { type: 'object' as const, properties: { address: { type: 'string' as const, default: '' } } }, uiHints: {} },
};
const card: DeviceCardModel = {
  key: 'future:primary', endpoint,
  adapter: { adapterId: 'future', displayName: 'Future interface', contractVersion: 1, protocol: 'future', transport: 'future', direction: 'peer', operations, dataDomains: ['points'], endpoints: [endpoint] },
};
const capabilityEntry: PaletteEntry = { key: card.key, label: card.adapter.displayName, title: card.adapter.displayName, icon: null, nodeType: 'acquisition', acquisition: card };
const entries = [capabilityEntry];
const syncGraph = () => useAppStore.getState().syncTabGraph('default');

beforeEach(async () => {
  await syncGraph();
  __resetForTests();
  resetCapabilityCatalogForTests();
  vi.stubGlobal('PointerEvent', MouseEvent);
  tauriMock.invoke.mockClear();
  tauriMock.invoke.mockResolvedValue(undefined);
  useAppStore.setState({ rfNodes: [], rfEdges: [], controlTabs: [{ id: 'default', name: 'Tab 1' }], activeControlTabId: 'default', dataTabs: [], lang: 'en' });
  useHistoryStore.getState().clearHistory();
});
afterEach(async () => { cleanup(); __resetForTests(); await syncGraph(); vi.restoreAllMocks(); });

describe('all interface palette entries', () => {
  it.each(entries)('$label creates one independent node per click/drop and consumes the trailing click', async (entry) => {
    const activate = (item: PaletteEntry) => { addPaletteNode(item, { x: 60, y: 60 }); };
    render(<PaletteRow entry={entry} category="transport" entering={false} exiting={false} onActivate={activate} onEnterPlayed={() => undefined} />);
    const row = screen.getByRole('button', { name: entry.label });
    fireEvent.click(row);
    const canvas = document.createElement('div');
    canvas.dataset.dockZone = 'canvas';
    document.body.appendChild(canvas);
    document.elementFromPoint = () => canvas;
    dockDrag.registerCanvasHandler(canvas, (x, y, spec) => { addPaletteNode(spec, { x, y }); });
    fireEvent.pointerDown(row, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { button: 0, clientX: 350, clientY: 210 });
    fireEvent.pointerUp(window, { button: 0, clientX: 350, clientY: 210 });
    fireEvent.click(row);
    const nodes = useAppStore.getState().rfNodes;
    expect(nodes).toHaveLength(2);
    expect(nodes[0].id).not.toBe(nodes[1].id);
    expect(nodes[1].position).toEqual({ x: 350, y: 210 });
    expect(nodes[1].type).toBe(entry.nodeType);
    expect(useAppStore.getState().dataTabs).toEqual([]);
    await syncGraph();
    canvas.remove();
  });

  it('persists incomplete drafts and restores delete/undo with the same identity', async () => {
    addPaletteNode(capabilityEntry, { x: 140, y: 220 });
    const node = useAppStore.getState().rfNodes[0];
    const spec = (node.data as AcquisitionNodeData).spec;
    await syncGraph();
    expect(tauriMock.invoke).toHaveBeenCalledWith('update_tab_graph', expect.objectContaining({ documents: [nodeDocument(node)] }));
    expect(spec.driver.payload).toEqual({ address: '' });
    useAppStore.getState().onNodesChange([{ type: 'remove', id: node.id }]);
    await syncGraph();
    expect(tauriMock.invoke).toHaveBeenCalledWith('update_tab_graph', expect.objectContaining({ documents: [] }));
    useHistoryStore.getState().undo();
    await syncGraph();
    expect(useAppStore.getState().rfNodes[0].id).toBe(spec.id);
    expect(useAppStore.getState().rfNodes[0].position).toEqual({ x: 140, y: 220 });
  });

  it('hydrates unknown adapters and positions without recreating a dedicated tab', async () => {
    const spec = { id: 'saved-device', label: 'Saved', enabled: true, capabilityEndpointId: 'primary', driver: { driverId: 'not-installed', schemaVersion: 9, payload: { preserved: true } } };
    vi.spyOn(api, 'workspaceGet').mockResolvedValueOnce({
      version: 1, tabs: [], data_tabs: [{ id: 'obsolete', type: 'acquisition-endpoint', name: 'Old', closable: true }],
      graphs: [{ tab_id: 'default', documents: [{ ...deviceDocument(spec.id), kind: 'device', label: spec.label, layout: { x: 120, y: 340, width: null, height: null }, config: { enabled: true, capabilityEndpointId: 'primary', driver: spec.driver }, attributes: { testData: null } }], edges: [] }],
    });
    expect(await hydrateWorkspaceFromBackend()).toBe(true);
    const node = useAppStore.getState().rfNodes[0];
    expect(node).toMatchObject({ id: spec.id, type: 'acquisition', position: { x: 120, y: 340 }, data: { spec } });
    expect(useAppStore.getState().dataTabs.map((tab) => tab.type)).not.toContain('acquisition-endpoint');
  });

  it('edits only the selected instance through the shared Properties panel', async () => {
    vi.spyOn(api, 'listAdapterCapabilities').mockResolvedValue([card.adapter]);
    vi.spyOn(api, 'listAcquisitionEndpoints').mockResolvedValue([]);
    addPaletteNode(capabilityEntry, { x: 10, y: 20 });
    addPaletteNode(capabilityEntry, { x: 40, y: 50 });
    const firstId = useAppStore.getState().rfNodes[0].id;
    useAppStore.getState().onNodesChange([{ type: 'select', id: firstId, selected: true }]);
    render(<NodePropertiesPanel />);
    const name = await screen.findByRole('textbox', { name: 'Widget Name' });
    fireEvent.change(name, { target: { value: 'PLC A' } });
    fireEvent.blur(name);
    const [first, second] = useAppStore.getState().rfNodes;
    expect((first.data as AcquisitionNodeData).spec.label).toBe('PLC A');
    expect((second.data as AcquisitionNodeData).spec.label).toBe('Future interface');
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(useAppStore.getState().dataTabs).toEqual([]);
    await syncGraph();
  });
});
