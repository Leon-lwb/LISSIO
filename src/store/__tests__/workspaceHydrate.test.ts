import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../lib/tauri/tauri';
import { hydrateWorkspaceFromBackend } from '../appStoreHelpers';
import { useAppStore } from '../appStore';
import { deviceDocument, protocolDocument, widgetDocument } from '../../test/nodeDocuments';
import { nodeDocument } from '../../lib/nodes/document';
import { resetCapabilityCatalogForTests } from '../../lib/acquisition/capabilityCatalog';

beforeEach(() => {
  vi.restoreAllMocks();
  resetCapabilityCatalogForTests();
  useAppStore.setState({ rfNodes: [], rfEdges: [], connectionStates: {} });
  vi.spyOn(api, 'listAdapterCapabilities').mockResolvedValue([]);
});

it('returns false when no workspace exists', async () => {
  vi.spyOn(api, 'workspaceGet').mockResolvedValue(null);
  expect(await hydrateWorkspaceFromBackend()).toBe(false);
});

it('restores every node kind, draft attribute, label and layout from one document', async () => {
  const docs = [deviceDocument(), protocolDocument(), widgetDocument()];
  vi.spyOn(api, 'workspaceGet').mockResolvedValue({ version: 3, tabs: [{ id: 'default', name: 'One' }], data_tabs: [],
    graphs: [{ tab_id: 'default', documents: docs, edges: [] }] });
  const open = vi.spyOn(api, 'openAcquisitionEndpoint');
  expect(await hydrateWorkspaceFromBackend()).toBe(true);
  expect(useAppStore.getState().rfNodes.map(nodeDocument)).toEqual(docs);
  expect(open).not.toHaveBeenCalled();
  expect(useAppStore.getState().connectionStates).toEqual({});
});

it('keeps devices and protocols in their saved tab without duplication', async () => {
  const docs = [deviceDocument('a', 'first'), protocolDocument('b', 'second')];
  vi.spyOn(api, 'workspaceGet').mockResolvedValue({ version: 1, tabs: [{ id: 'first', name: 'One' }, { id: 'second', name: 'Two' }], data_tabs: [],
    graphs: [{ tab_id: 'first', documents: [docs[0]], edges: [] }, { tab_id: 'second', documents: [docs[1]], edges: [] }] });
  await hydrateWorkspaceFromBackend();
  expect(useAppStore.getState().getTabNodes('first').map(n => n.id)).toEqual(['a']);
  expect(useAppStore.getState().getTabNodes('second').map(n => n.id)).toEqual(['b']);
});

it('preserves an unavailable driver draft without opening hardware', async () => {
  const doc = deviceDocument();
  if (doc.kind !== 'device') throw new Error('fixture');
  doc.config.driver = { driverId: 'unavailable', schemaVersion: 9, payload: { draft: true } };
  vi.spyOn(api, 'workspaceGet').mockResolvedValue({ version: 1, tabs: [], data_tabs: [], graphs: [{ tab_id: 'default', documents: [doc], edges: [] }] });
  await hydrateWorkspaceFromBackend();
  expect(nodeDocument(useAppStore.getState().rfNodes[0])).toEqual(doc);
});
