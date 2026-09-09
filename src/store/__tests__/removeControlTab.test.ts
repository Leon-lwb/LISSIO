import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMock } from '../../test/setup';
import { useAppStore } from '../appStore';
import { useHistoryStore } from '../historyStore';
import { canvasNode } from '../../lib/nodes/document';
import { deviceDocument, widgetDocument } from '../../test/nodeDocuments';

describe('tab-owned document deletion', () => {
  beforeEach(() => {
    tauriMock.invoke.mockClear();
    tauriMock.invoke.mockResolvedValue(undefined);
    useAppStore.setState({
      controlTabs: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      activeControlTabId: 'a',
      rfNodes: [canvasNode(deviceDocument('da', 'a')), canvasNode(widgetDocument('wa', 'a')), canvasNode(deviceDocument('db', 'b'))],
      rfEdges: [{ id: 'ea', source: 'da', target: 'wa' }],
      dataTabs: [{ id: 'wa', type: 'number-display', name: 'A', widgetId: 'wa', closable: true }],
      connectionStates: { da: 'Connected', db: 'Connected' },
    } as never);
    useHistoryStore.getState().clearHistory();
  });

  it('deletes exactly one tab document, its views and its device session', async () => {
    useAppStore.getState().removeControlTab('a');
    expect(useAppStore.getState().rfNodes.map(node => node.id)).toEqual(['db']);
    expect(useAppStore.getState().rfEdges).toEqual([]);
    expect(useAppStore.getState().dataTabs).toEqual([]);
    expect(tauriMock.invoke).toHaveBeenCalledWith('close_transport', { nodeId: 'da' });
    await vi.waitFor(() => expect(tauriMock.invoke).toHaveBeenCalledWith('remove_tab_graph', { tabId: 'a' }));
  });

  it('undo restores configuration but never reconnects', () => {
    useAppStore.getState().removeControlTab('a');
    useHistoryStore.getState().undo();
    expect(useAppStore.getState().rfNodes.some(node => node.id === 'da')).toBe(true);
    expect(tauriMock.invoke).not.toHaveBeenCalledWith('open_acquisition_endpoint', expect.anything());
  });

  it('deleting the final tab creates a fresh empty tab', () => {
    useAppStore.setState({ controlTabs: [{ id: 'a', name: 'A' }], rfNodes: [] } as never);
    useAppStore.getState().removeControlTab('a');
    expect(useAppStore.getState().controlTabs).toHaveLength(1);
    expect(useAppStore.getState().controlTabs[0].id).not.toBe('a');
  });
});
