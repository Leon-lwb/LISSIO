import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUICK_START_TEMPLATES, getTemplate } from '../quickstart/templates';
import { applyTemplate } from '../quickstart/applyTemplate';
import { useAppStore } from '../../store/appStore';
import { selectWidgets } from '../../store/appStoreHelpers';
import { resetModelCatalogForTests } from '../../store/modelCatalogStore';
import { seedModelCatalogForTests, mockPrepareEcho } from '../../test/modelCatalog';
import type { DeviceTreeNodeDecl, ProtocolSchema } from '../../types';

describe('quick-start node documents', () => {
  beforeEach(() => {
    seedModelCatalogForTests();
    mockPrepareEcho();
  });

  afterEach(() => {
    resetModelCatalogForTests();
    vi.restoreAllMocks();
  });

  it('ships the core examples', () => {
    expect(QUICK_START_TEMPLATES.map(template => template.id))
      .toEqual(expect.arrayContaining(['math', 'filter', 'fft', 'can', 'serial', 'demo']));
  });

  it('every template is a self-contained tab-owned v4 document', async () => {
    for (const template of QUICK_START_TEMPLATES) {
      const snapshot = await template.build();
      expect(snapshot.version).toBe(4);
      const workspace = snapshot.workspace!;
      expect(workspace.tabs).toHaveLength(1);
      expect(workspace.graphs).toHaveLength(1);
      const graph = workspace.graphs[0];
      const ids = new Set(graph.documents.map(document => document.id));
      expect(ids.size).toBe(graph.documents.length);
      expect(graph.documents.every(document => document.tabId === graph.tab_id)).toBe(true);
      expect(graph.documents.some(document => document.kind === 'device')).toBe(true);
      const device = graph.documents.find(document => document.kind === 'device');
      const childIds = device?.kind === 'device' ? device.config.node.children.map(child => child.id) : [];
      expect(device?.kind === 'device' && device.config.node.children.some(child => child.driver === 'protocol-engine')).toBe(true);
      expect(graph.edges.every(edge => [...ids, ...childIds].includes(edge.source) && [...ids, ...childIds].includes(edge.target))).toBe(true);
      expect(snapshot.dockCards?.['properties-main']?.tabIds).toEqual(['node-properties-fixed']);
    }
  });

  it('the serial example is Serial + test attribute -> JustFloat', async () => {
    const graph = (await getTemplate('serial')!.build()).workspace!.graphs[0];
    const device = graph.documents.find(document => document.kind === 'device');
    expect(device?.kind === 'device' && device.config.node.driver).toBe('serial');
    const simulation = device?.kind === 'device'
      ? device.config.node.children.find((child) => child.driver === 'simulation')
      : undefined;
    expect((simulation?.config as { sampleRate?: number } | undefined)?.sampleRate).toBeGreaterThan(0);
    const protocol = device?.kind === 'device'
      ? device.config.node.children.find(child => child.driver === 'protocol-engine') : undefined;
    expect(((protocol?.config as { protocol?: { kind?: string } }).protocol)?.kind).toBe('JustFloat');
    expect(graph.edges.some(edge => edge.source === protocol?.id)).toBe(true);
  });

  it('custom protocol keeps named decode ports and an encoding rule', async () => {
    const graph = (await getTemplate('custom-protocol')!.build()).workspace!.graphs[0];
    const device = graph.documents.find(document => document.kind === 'device');
    const protocol = device?.kind === 'device'
      ? device.config.node.children.find(child => child.driver === 'protocol-engine') : undefined;
    const schema = (protocol?.config as { schema?: ProtocolSchema }).schema;
    expect(schema?.preset).toBe('custom');
    expect(schema?.decode.filter(block => block.type === 'field').map(block => block.portName))
      .toEqual(['speed', 'temp']);
    expect(schema?.encode?.length).toBeGreaterThan(0);
    expect(graph.edges.some(edge => edge.source_handle === 'speed')).toBe(true);
  });
});

describe('template application', () => {
  beforeEach(() => {
    seedModelCatalogForTests();
    mockPrepareEcho();
    useAppStore.setState({
      controlTabs: [{ id: 'default', name: 'Tab 1' }],
      dataTabs: [], activeControlTabId: 'default', activeDataTabId: '',
      rfNodes: [], rfEdges: [], connectionStates: {},
    } as never);
  });

  afterEach(() => {
    resetModelCatalogForTests();
    vi.restoreAllMocks();
  });

  it('merge remaps every node and owns all of them from a new tab', async () => {
    const snapshot = await getTemplate('math')!.build();
    const originalIds = new Set(snapshot.workspace!.graphs[0].documents.map(document => document.id));
    await applyTemplate(snapshot, 'merge');
    const state = useAppStore.getState();
    const tab = state.controlTabs.find(candidate => candidate.id.startsWith('tpl-'))!;
    const nodes = state.rfNodes.filter(node => node.data.tabId === tab.id);
    expect(nodes).toHaveLength(snapshot.workspace!.graphs[0].documents.length);
    expect(nodes.every(node => !originalIds.has(node.id))).toBe(true);
    const treeIds = nodes.flatMap(node => node.type === 'acquisition'
      ? ((node.data.node as DeviceTreeNodeDecl).children.map(child => child.id)) : []);
    expect(treeIds).not.toContain('template-protocol');
    expect(treeIds.some(id => state.rfEdges.some(edge => edge.source === id))).toBe(true);
    expect(state.rfEdges.every(edge => [...nodes.map(node => node.id), ...treeIds].includes(edge.source)
      && [...nodes.map(node => node.id), ...treeIds].includes(edge.target))).toBe(true);
  });

  it('replace restores the exact document and remains disconnected', async () => {
    const snapshot = await getTemplate('filter')!.build();
    await applyTemplate(snapshot, 'replace');
    const state = useAppStore.getState();
    expect(state.rfNodes).toHaveLength(snapshot.workspace!.graphs[0].documents.length);
    expect(selectWidgets(state)).toHaveLength(snapshot.workspace!.graphs[0].documents.filter(document => document.kind === 'widget').length);
    expect(Object.values(state.connectionStates)).not.toContain('Connected');
  });
});
