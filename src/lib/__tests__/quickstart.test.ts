import { beforeEach, describe, expect, it } from 'vitest';
import { QUICK_START_TEMPLATES, getTemplate } from '../quickstart/templates';
import { applyTemplate } from '../quickstart/applyTemplate';
import { useAppStore } from '../../store/appStore';
import { selectWidgets } from '../../store/appStoreHelpers';

describe('quick-start node documents', () => {
  it('ships the core examples', () => {
    expect(QUICK_START_TEMPLATES.map(template => template.id))
      .toEqual(expect.arrayContaining(['math', 'filter', 'fft', 'can', 'serial', 'demo']));
  });

  it('every template is a self-contained tab-owned v4 document', () => {
    for (const template of QUICK_START_TEMPLATES) {
      const snapshot = template.build();
      expect(snapshot.version).toBe(4);
      const workspace = snapshot.workspace!;
      expect(workspace.tabs).toHaveLength(1);
      expect(workspace.graphs).toHaveLength(1);
      const graph = workspace.graphs[0];
      const ids = new Set(graph.documents.map(document => document.id));
      expect(ids.size).toBe(graph.documents.length);
      expect(graph.documents.every(document => document.tabId === graph.tab_id)).toBe(true);
      expect(graph.documents.some(document => document.kind === 'device')).toBe(true);
      expect(graph.documents.some(document => document.kind === 'protocol')).toBe(true);
      expect(graph.edges.every(edge => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
      expect(graph.documents.some(document => document.kind === 'device')).toBe(true);
      expect(snapshot.dockCards?.['properties-main']?.tabIds).toEqual(['node-properties-fixed']);
    }
  });

  it('the serial example is Serial + test attribute -> JustFloat', () => {
    const graph = getTemplate('serial')!.build().workspace!.graphs[0];
    const device = graph.documents.find(document => document.kind === 'device');
    const protocol = graph.documents.find(document => document.kind === 'protocol');
    expect(device?.kind === 'device' && device.config.driver.driverId).toBe('serial');
    expect(device?.attributes.testData?.sampleRate).toBeGreaterThan(0);
    expect(protocol?.kind === 'protocol' && protocol.config.protocol.kind).toBe('JustFloat');
    expect(graph.edges.some(edge => edge.source === device?.id && edge.target === protocol?.id)).toBe(true);
  });

  it('custom protocol keeps named decode ports and an encoding rule', () => {
    const graph = getTemplate('custom-protocol')!.build().workspace!.graphs[0];
    const protocol = graph.documents.find(document => document.kind === 'protocol');
    expect(protocol?.kind).toBe('protocol');
    if (protocol?.kind !== 'protocol') return;
    expect(protocol.config.schema.preset).toBe('custom');
    expect(protocol.config.schema.decode.filter(block => block.type === 'field').map(block => block.portName))
      .toEqual(['speed', 'temp']);
    expect(protocol.config.schema.encode?.length).toBeGreaterThan(0);
    expect(graph.edges.some(edge => edge.source_handle === 'speed')).toBe(true);
  });
});

describe('template application', () => {
  beforeEach(() => useAppStore.setState({
    controlTabs: [{ id: 'default', name: 'Tab 1' }],
    dataTabs: [], activeControlTabId: 'default', activeDataTabId: '',
    rfNodes: [], rfEdges: [], connectionStates: {},
  } as never));

  it('merge remaps every node and owns all of them from a new tab', async () => {
    const snapshot = getTemplate('math')!.build();
    const originalIds = new Set(snapshot.workspace!.graphs[0].documents.map(document => document.id));
    await applyTemplate(snapshot, 'merge');
    const state = useAppStore.getState();
    const tab = state.controlTabs.find(candidate => candidate.id.startsWith('tpl-'))!;
    const nodes = state.rfNodes.filter(node => node.data.tabId === tab.id);
    expect(nodes).toHaveLength(snapshot.workspace!.graphs[0].documents.length);
    expect(nodes.every(node => !originalIds.has(node.id))).toBe(true);
    expect(state.rfEdges.every(edge => nodes.some(node => node.id === edge.source) && nodes.some(node => node.id === edge.target))).toBe(true);
  });

  it('replace restores the exact document and remains disconnected', async () => {
    const snapshot = getTemplate('filter')!.build();
    await applyTemplate(snapshot, 'replace');
    const state = useAppStore.getState();
    expect(state.rfNodes).toHaveLength(snapshot.workspace!.graphs[0].documents.length);
    expect(selectWidgets(state)).toHaveLength(snapshot.workspace!.graphs[0].documents.filter(document => document.kind === 'widget').length);
    expect(Object.values(state.connectionStates)).not.toContain('Connected');
  });
});
