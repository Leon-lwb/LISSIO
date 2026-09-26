import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { api } from '../../tauri/tauri';
import { useAppStore } from '../../../store/appStore';
import { useHistoryStore } from '../../../store/historyStore';
import { createWidget } from '../../utils/widgetDefaults';
import { acquisitionNodeFromDecl, simulationConfig, type AcquisitionNodeData } from '../acquisitionNodes';
import { applyTestAttribute } from '../simulation';
import { tauriMock } from '../../../test/setup';

vi.mock('../../utils/revealDataTab', () => ({ openNodePropertiesPanel: vi.fn() }));

const device = (): Node<AcquisitionNodeData> => {
  const node = acquisitionNodeFromDecl({
    id: 'serial-1',
    name: 'Serial',
    driver: 'serial',
    schemaVersion: 1,
    config: { port_name: '/dev/test' },
    enabled: true,
    capabilityEndpointId: 'device',
    children: [],
  });
  node.selected = true;
  node.data.ports = [
    { id: 'rx', direction: 'output', domain: 'bytes' },
    { id: 'tx', direction: 'input', domain: 'bytes' },
  ];
  return node;
};

const display = (): Node => {
  const widget = createWidget('NumberDisplay');
  widget.params.id = 'display-1';
  return {
    id: 'display-1',
    type: 'widget',
    position: { x: 300, y: 20 },
    data: { tabId: 'default', widget },
  };
};

beforeEach(() => {
  tauriMock.invoke.mockReset();
  tauriMock.invoke.mockResolvedValue(undefined);
  useAppStore.setState({
    rfNodes: [],
    rfEdges: [],
    controlTabs: [{ id: 'default', name: 'Tab 1' }],
    activeControlTabId: 'default',
    dataTabs: [],
    activeDataTabId: '',
  });
  useHistoryStore.getState().clearHistory();
});

describe('test-data device attribute', () => {
  it('ignores disabled simulation children when projecting the active source', () => {
    const node = device().data.node;
    node.children.push({
      id: 'serial-1::simulation',
      name: 'simulation',
      driver: 'simulation',
      schemaVersion: 1,
      config: { channels: 2 },
      enabled: false,
      children: [],
    });
    expect(simulationConfig(node)).toBeNull();
    node.children[0].enabled = true;
    expect(simulationConfig(node)).toEqual({ channels: 2 });
  });

  it('attaches once, closes the active session, and preserves device identity and topology', async () => {
    const source = device();
    const edge: Edge = {
      id: 'edge-1',
      source: source.id,
      sourceHandle: 'rx',
      target: 'display-1',
      targetHandle: 'value',
    };
    useAppStore.setState({ rfNodes: [source, display()], rfEdges: [edge] });
    const close = vi.spyOn(api, 'closeAcquisitionNode').mockResolvedValue(undefined);

    expect(applyTestAttribute()).toBe(true);
    await Promise.resolve();

    const after = useAppStore.getState();
    const attached = after.rfNodes.find(node => node.id === source.id) as Node<AcquisitionNodeData>;
    expect(attached.data.node).toMatchObject({
      id: 'serial-1',
      driver: source.data.node.driver,
      config: source.data.node.config,
    });
    expect(simulationConfig(attached.data.node)).toMatchObject({
      sampleRate: 100,
      seed: 1,
      channels: 4,
    });
    expect(attached.data.ports).toEqual(source.data.ports);
    expect(after.rfEdges).toEqual([edge]);
    expect(close).toHaveBeenCalledTimes(1);

    expect(applyTestAttribute(source.id)).toBe(true);
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().rfNodes).toHaveLength(2);
  });

  it('does not create content on blank space, non-device nodes, or ambiguous selection', () => {
    const source = device();
    const sink = { ...display(), selected: true };
    source.selected = false;
    useAppStore.setState({ rfNodes: [source, sink], rfEdges: [] });

    expect(applyTestAttribute('missing')).toBe(false);
    expect(applyTestAttribute(sink.id)).toBe(false);
    expect(applyTestAttribute()).toBe(false);
    expect(useAppStore.getState().rfNodes).toEqual([source, sink]);
  });
});
