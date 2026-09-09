import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../appStore';
import { adoptSourceGraph, syncTabGraphToBackend } from '../appStoreHelpers';
import { canvasNode, nodeDocument } from '../../lib/nodes/document';
import { documentNodes, deviceDocument, protocolDocument, widgetDocument } from '../../test/nodeDocuments';
import { api } from '../../lib/tauri/tauri';

beforeEach(() => {
  useAppStore.setState({ rfNodes: documentNodes(), rfEdges: [], controlTabs: [{ id: 'default', name: 'One' }], graphVersion: 1, dataTabs: [] });
});

describe('authoritative tab documents', () => {
  it('replaces all node kinds and edges only in their owning tab', () => {
    const other = canvasNode(deviceDocument('other', 'second'));
    useAppStore.setState(s => ({ rfNodes: [...s.rfNodes, other] }));
    adoptSourceGraph({ tab_id: 'default', version: 2, documents: [protocolDocument()], edges: [] });
    expect(useAppStore.getState().rfNodes.map(n => n.id).sort()).toEqual(['other', 'parser']);
    expect(useAppStore.getState().rfNodes.find(n => n.id === 'other')).toBe(other);
    expect(useAppStore.getState().graphVersion).toBe(2);
  });

  it.each([deviceDocument(), protocolDocument(), widgetDocument()])('restores labels and explicit/auto dimensions for $kind', doc => {
    const changed = { ...doc, label: 'Renamed', layout: { x: 100, y: 200, width: 350, height: 240 } };
    adoptSourceGraph({ tab_id: 'default', version: 2, documents: [changed], edges: [] });
    expect(nodeDocument(useAppStore.getState().rfNodes[0])).toEqual(changed);
    const auto = { ...changed, layout: { ...changed.layout, width: null, height: null } };
    adoptSourceGraph({ tab_id: 'default', version: 3, documents: [auto], edges: [] });
    expect(useAppStore.getState().rfNodes[0].width).toBeUndefined();
    expect(useAppStore.getState().rfNodes[0].height).toBeUndefined();
  });

  it('does not replace unchanged node objects', () => {
    const nodes = useAppStore.getState().rfNodes;
    adoptSourceGraph({ tab_id: 'default', version: 2, documents: nodes.map(nodeDocument), edges: [] });
    expect(useAppStore.getState().rfNodes).toBe(nodes);
  });

  it('adopts remote documents on a version conflict before retrying', async () => {
    const remote = protocolDocument('remote');
    const update = vi.spyOn(api, 'updateTabGraph').mockRejectedValueOnce({ data: { current: 2 } }).mockResolvedValueOnce({ version: 3, nodes: [] });
    const source = vi.spyOn(api, 'getSourceGraph').mockResolvedValueOnce({ tab_id: 'default', version: 2, documents: [remote], edges: [] });
    expect(await syncTabGraphToBackend('default')).toBeUndefined();
    expect(update.mock.calls[1][1]).toEqual([remote]);
    expect(useAppStore.getState().graphVersion).toBe(3);
    update.mockRestore(); source.mockRestore();
  });
});
