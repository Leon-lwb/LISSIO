import { beforeEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../appStore';
import { syncTabGraphToBackend } from '../appStoreHelpers';
import { api } from '../../lib/tauri/tauri';
import { documentNodes, deviceDocument, protocolDocument } from '../../test/nodeDocuments';
import { canvasNode, nodeDocument } from '../../lib/nodes/document';
import { useHistoryStore } from '../historyStore';

beforeEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({ rfNodes: documentNodes(), rfEdges: [{ id: 'edge', source: 'device', sourceHandle: 'rx', target: 'parser', targetHandle: 'in' }],
    activeControlTabId: 'default', controlTabs: [{ id: 'default', name: 'One' }], graphVersion: null });
  vi.spyOn(api, 'updateTabGraph').mockResolvedValue({ nodes: [], version: 1 });
  useHistoryStore.getState().clearHistory();
});

it('submits one document per node, with no parallel device/widget configuration payload', async () => {
  const docs = useAppStore.getState().rfNodes.map(nodeDocument);
  await syncTabGraphToBackend('default');
  expect(api.updateTabGraph).toHaveBeenCalledWith('default', docs, [{ id: 'edge', source: 'device', source_handle: 'rx', target: 'parser', target_handle: 'in' }], null);
  const widget = docs.find(d => d.kind === 'widget');
  if (widget?.kind !== 'widget') throw new Error('fixture');
  expect(widget.config.params).not.toHaveProperty('id');
  expect(widget.config.params).not.toHaveProperty('label');
});

it('submits only nodes and edges belonging to the requested tab', async () => {
  useAppStore.setState(s => ({ rfNodes: [...s.rfNodes, canvasNode(deviceDocument('other', 'second'))] }));
  await syncTabGraphToBackend('default');
  expect(vi.mocked(api.updateTabGraph).mock.calls[0][1].map(n => n.id)).toEqual(['device', 'parser', 'widget']);
});

it('rejects cross-tab connections before history or graph mutation', () => {
  useAppStore.setState(s => ({ rfNodes: [...s.rfNodes, canvasNode(protocolDocument('other', 'second'))] }));
  const previous = useAppStore.getState().rfEdges;
  useAppStore.getState().onConnect({ source: 'device', sourceHandle: 'rx', target: 'other', targetHandle: 'in' });
  expect(useAppStore.getState().rfEdges).toBe(previous);
});

it('deleting a node removes its edges, undo restores its configuration without connecting', async () => {
  const open = vi.spyOn(api, 'openAcquisitionNode');
  useAppStore.getState().removeNode('device');
  await syncTabGraphToBackend('default');
  expect(useAppStore.getState().rfEdges).toEqual([]);
  useHistoryStore.getState().undo();
  await syncTabGraphToBackend('default');
  expect(useAppStore.getState().rfNodes.find(n => n.id === 'device')).toBeDefined();
  expect(open).not.toHaveBeenCalled();
});

it('deleting a byte edge updates the owning tab document', async () => {
  useAppStore.getState().onEdgesChange([{ type: 'remove', id: 'edge' }]);
  await syncTabGraphToBackend('default');
  expect(vi.mocked(api.updateTabGraph).mock.lastCall?.[2]).toEqual([]);
});
