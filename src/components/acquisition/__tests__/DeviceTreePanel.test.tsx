import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedModelCatalogForTests, mockPrepareEcho } from '../../../test/modelCatalog';
import { resetModelCatalogForTests } from '../../../store/modelCatalogStore';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AdapterCapability, DriverManifestProjection } from '../../../types';
import { useAppStore } from '../../../store/appStore';
import { api } from '../../../lib/tauri/tauri';
import { acquisitionNodeFromDecl } from '../../../test/acquisitionFixtures';
import { DeviceTreePanel } from '../DeviceTreePanel';

const operations = { byteSource: true, byteSink: true, discover: false, browse: false,
  read: false, subscribe: false, write: false, method: false };
const adapter: AdapterCapability = { contractVersion: 1, adapterId: 'serial', displayName: 'Serial',
  protocol: 'serial', transport: 'serial', direction: 'peer', operations, dataDomains: ['bytes'],
  endpoints: [{ id: 'serial', displayName: 'Serial', transport: 'serial', direction: 'peer',
    status: { state: 'available', detail: null }, ports: [{ id: 'rx', displayName: 'RX', direction: 'output',
      dataDomain: 'bytes', operations, dataTypes: [], addressSpace: null, display: null }],
    configuration: { schemaVersion: 1, jsonSchema: { type: 'object' }, uiHints: null }, display: null }],
  display: null };
const capabilities = { byteSource: true, byteSink: true, canFrameSource: false, canFrameSink: false,
  read: false, subscribe: false, write: false, invoke: false, browse: false, discover: false };
const manifest: DriverManifestProjection = { driverId: 'serial', role: 'bus', capabilities,
  ports: adapter.endpoints[0].ports,
  configSchema: { schemaVersion: 1, jsonSchema: { type: 'object' }, uiHints: null },
  childPolicy: { allowed: { protocol: { minimum: 0, maximum: null }, virtual: { minimum: 0, maximum: 1 } } } };

vi.mock('../../../lib/acquisition/capabilityCatalog', () => ({ loadAdapterCapabilities: vi.fn(() => Promise.resolve([adapter])) }));
vi.mock('../../../lib/acquisition/useDeviceNodeSnapshot', () => ({
  useDeviceNodeSnapshot: () => undefined,
  refreshDeviceNodeSnapshots: vi.fn(() => Promise.resolve()),
}));

describe('DeviceTreePanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'listDriverManifests').mockResolvedValue([manifest]);
    vi.spyOn(api, 'closeAcquisitionNode').mockResolvedValue(undefined);
    useAppStore.setState({ rfNodes: [], rfEdges: [], activeControlTabId: 'default', selectedDeviceTreeNodeId: null,
      controlTabs: [{ id: 'default', name: 'Default' }] });
    vi.spyOn(useAppStore.getState(), 'syncAllTabGraphs').mockImplementation(() => undefined);
    // 协议子节点创建经目录 prepare — 目录就绪 + prepare 桩须在 restoreAllMocks 之后安装
    seedModelCatalogForTests();
    mockPrepareEcho();
  });
  afterEach(() => {
    resetModelCatalogForTests();
    vi.restoreAllMocks();
  });

  it('adds a protocol under a selected device and edits it as a persisted child', async () => {
    const root = acquisitionNodeFromDecl({ id: 'root', name: 'Serial 1', driver: 'serial',
      schemaVersion: 1, config: {}, enabled: true, children: [] }, undefined, undefined, 'default');
    root.data.ports = [{ id: 'rx', direction: 'output', domain: 'bytes' }];
    useAppStore.setState({ rfNodes: [root] });
    render(<DeviceTreePanel />);
    fireEvent.click(screen.getByRole('button', { name: /Serial 1/ }));
    const add = await screen.findByRole('button', { name: /添加协议引擎|Add protocol engine/ });
    fireEvent.click(add);
    await waitFor(() => expect((useAppStore.getState().rfNodes[0].data.node as { children: unknown[] }).children).toHaveLength(1));
    const child = (useAppStore.getState().rfNodes[0].data.node as { children: { driver: string; config: Record<string, unknown> }[] }).children[0];
    expect(child.driver).toBe('protocol-engine');
    expect(child.config.protocol).toMatchObject({ kind: 'JustFloat' });
    expect(screen.getByRole('tree')).toHaveTextContent('JustFloat');
  });
});
