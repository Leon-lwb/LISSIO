import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tauriMock } from '../../../test/setup';
import { useAppStore } from '../../../store/appStore';
import { canvasNode } from '../../nodes/document';
import {
  describeDomainToUi,
  getDescribeEntry,
  invalidateDescriptions,
  resetDescribeForTests,
  startDescribeSync,
  stopDescribeSync,
  useDescribeStore,
} from '../describeStore';
import { deviceDocument, widgetDocument } from '../../../test/nodeDocuments';
import type { AcquisitionNodeData } from '../../acquisition/acquisitionNodes';

function canvasNodeFor(doc: ReturnType<typeof widgetDocument>) {
  return canvasNode(doc);
}

function descriptionFixture(nodeId: string, overrides: Record<string, unknown> = {}) {
  return {
    nodeId,
    requestRevision: 1,
    status: 'ready',
    inputs: [],
    outputs: [{ handle: 'value', label: 'value', domain: 'F32', connectDomains: [], dynamic: false, maxConnections: null }],
    defaultInput: null,
    defaultOutput: null,
    effectiveChannels: null,
    hint: null,
    issues: [],
    ...overrides,
  };
}

describe('describeStore', () => {
  beforeEach(() => {
    resetDescribeForTests();
    useAppStore.setState({ rfNodes: [], rfEdges: [] });
  });

  afterEach(() => {
    resetDescribeForTests();
    useAppStore.setState({ rfNodes: [], rfEdges: [] });
    tauriMock.invoke.mockReset();
  });

  it('maps port domains to UI vocabulary', () => {
    expect(describeDomainToUi('F32')).toBe('time');
    expect(describeDomainToUi('Spectrum')).toBe('freq');
    expect(describeDomainToUi('Bytes')).toBe('bytes');
    expect(describeDomainToUi('String')).toBe('string');
    expect(describeDomainToUi('Points')).toBe('points');
  });

  it('includes edges from device-tree protocol children when describing RawData ports', async () => {
    const device = canvasNode(deviceDocument('device'));
    const data = device.data as AcquisitionNodeData;
    data.node = { ...data.node, children: [...data.node.children, {
      id: 'parser', name: 'SLCAN', driver: 'protocol-engine', schemaVersion: 1, enabled: true,
      config: { protocol: { kind: 'Slcan' }, schema: { preset: 'slcan', decode: [] } }, children: [],
    }] };
    const raw = canvasNodeFor(widgetDocument('raw'));
    useAppStore.setState({ rfNodes: [device, raw], rfEdges: [{
      id: 'parser-raw', source: 'parser', sourceHandle: 'out', target: 'raw', targetHandle: 'src:parser:out',
    }] });
    startDescribeSync();
    await vi.waitFor(() => expect(tauriMock.invoke).toHaveBeenCalledWith('describe_node_documents',
      expect.objectContaining({ edges: [expect.objectContaining({ source: 'parser', target: 'raw' })] })));
  });

  it('adopts descriptions and clears removed nodes', async () => {
    const node = canvasNodeFor(widgetDocument('widget-a'));
    useAppStore.setState({ rfNodes: [node] });
    startDescribeSync();
    await vi.waitFor(() => {
      expect(tauriMock.invoke).toHaveBeenCalledWith('describe_node_documents', expect.anything());
    });
    // 默认 setup mock 返回空 nodes — absent 不会误标 ready
    expect(getDescribeEntry('widget-a').status).toBe('absent');

    useDescribeStore.getState().adopt([descriptionFixture('widget-a') as never]);
    expect(getDescribeEntry('widget-a').status).toBe('ready');

    // 节点删除后其描述不得残留
    useAppStore.setState({ rfNodes: [] });
    await vi.waitFor(() => {
      expect(getDescribeEntry('widget-a').status).toBe('absent');
    });
    stopDescribeSync();
  });

  it('keeps the previous description visible while pending', () => {
    useDescribeStore.getState().adopt([descriptionFixture('widget-a') as never]);
    useDescribeStore.getState().setPending(['widget-a']);
    const entry = getDescribeEntry('widget-a');
    expect(entry.status).toBe('pending');
    expect(entry.description?.outputs[0]?.handle).toBe('value');
  });

  it('keeps last description on failure and recovers on next adopt', () => {
    useDescribeStore.getState().adopt([descriptionFixture('widget-a') as never]);
    // 真实序列: flush 先 setPending, 请求失败再 markFailed
    useDescribeStore.getState().setPending(['widget-a', 'widget-b']);
    useDescribeStore.getState().markFailed();
    expect(getDescribeEntry('widget-a').description).not.toBeNull();
    const failed = getDescribeEntry('widget-b');
    expect(failed.status).toBe('absent');
    expect(failed.failed).toBe(true);
  });

  it('invalidates on generation bump helper', () => {
    useDescribeStore.getState().adopt([descriptionFixture('widget-a') as never]);
    invalidateDescriptions();
    expect(getDescribeEntry('widget-a').status).toBe('absent');
  });
});
