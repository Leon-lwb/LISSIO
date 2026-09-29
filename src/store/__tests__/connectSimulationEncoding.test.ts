import { beforeEach, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { useAppStore } from '../appStore';
import { api } from '../../lib/tauri/tauri';
import { canvasNode } from '../../lib/nodes/document';
import { deviceDocument } from '../../test/nodeDocuments';
import type { AcquisitionNodeData } from '../../lib/acquisition/acquisitionNodes';
import type { ProtocolSchema, DeviceTreeNodeSnapshot } from '../../types';

/// Slcan 协议节点文档 — 模拟用户工作区: 设备 (开测试数据) → Slcan 解析器
function slcanProtocolNode(id = 'parser', tabId = 'default'): Node {
  return canvasNode({
    id,
    tabId,
    label: 'Slcan',
    kind: 'protocol',
    layout: { x: 320, y: 60, width: null, height: null },
    config: {
      protocol: { kind: 'Slcan' },
      convertTo: null,
      schema: { preset: 'slcan', decode: [] } satisfies ProtocolSchema,
    },
  });
}

/// 设备节点 + 指定测试数据编码 (模拟持久化文档里的过期 encoding)
function deviceNodeWithSimulation(encoding: unknown): Node {
  const node = canvasNode(deviceDocument('device'));
  const data = node.data as AcquisitionNodeData;
  data.node = {
    ...data.node,
    children: data.node.children.map((child) =>
      child.driver === 'simulation'
        ? { ...child, config: { ...(child.config as Record<string, unknown>), encoding } }
        : child,
    ),
  };
  return node;
}

function simulationEncodingOf(nodes: Node[]): unknown {
  const device = nodes.find((n) => n.id === 'device');
  const data = (device?.data ?? {}) as AcquisitionNodeData;
  const child = data.node.children.find((c) => c.driver === 'simulation');
  return (child?.config as { encoding?: unknown } | undefined)?.encoding;
}

const EDGE: Edge = { id: 'edge', source: 'device', sourceHandle: 'rx', target: 'parser', targetHandle: 'in' };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // jsdom 无 requestAnimationFrame, connectNode 的波形窗口清空会用到
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.spyOn(api, 'setRawDataBufferCapacity').mockResolvedValue(undefined);
  vi.spyOn(api, 'setWaveformBufferCapacity').mockResolvedValue(undefined);
  vi.spyOn(api, 'clearBuffer').mockResolvedValue(undefined);
  vi.spyOn(api, 'clearRawDataBuffer').mockResolvedValue(undefined);
  // open 响应载荷未被 connectNode 消费, 仅需可 await
  vi.spyOn(api, 'openAcquisitionNode').mockResolvedValue({} as DeviceTreeNodeSnapshot);
  vi.spyOn(api, 'listDeviceTreeNodes').mockResolvedValue([]);
});

it('写回跟随下游协议的测试数据编码, 且在图同步与打开之前生效', async () => {
  // 持久化编码过期为 JustFloat — 后端 open 只读图文档, 不写回则下游 Slcan 解析零帧
  const stale = { protocol: { kind: 'JustFloat', channels: 4 }, schema: null };
  const syncTabGraph = vi.fn(() => Promise.resolve(undefined));
  useAppStore.setState({
    rfNodes: [deviceNodeWithSimulation(stale), slcanProtocolNode()],
    rfEdges: [EDGE],
    activeControlTabId: 'default',
    connectionStates: {},
    syncTabGraph,
  });

  await useAppStore.getState().connectNode('device');

  const resolved = simulationEncodingOf(useAppStore.getState().rfNodes);
  expect(resolved).toEqual({ protocol: { kind: 'Slcan' }, schema: { preset: 'slcan', decode: [] } });
  expect(syncTabGraph).toHaveBeenCalledWith('default');
  expect(api.openAcquisitionNode).toHaveBeenCalledWith('device');
  expect(syncTabGraph.mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(api.openAcquisitionNode).mock.invocationCallOrder[0],
  );
});

it('编码已与下游协议一致时不改写设备文档', async () => {
  const resolved = { protocol: { kind: 'Slcan' }, schema: { preset: 'slcan', decode: [] } };
  useAppStore.setState({
    rfNodes: [deviceNodeWithSimulation(resolved), slcanProtocolNode()],
    rfEdges: [EDGE],
    activeControlTabId: 'default',
    connectionStates: {},
    syncTabGraph: vi.fn(() => Promise.resolve(undefined)),
  });
  const nodesBefore = useAppStore.getState().rfNodes;

  await useAppStore.getState().connectNode('device');

  // 无差异 → 直接补丁不执行, 节点数组保持同一引用
  expect(useAppStore.getState().rfNodes).toBe(nodesBefore);
  expect(simulationEncodingOf(useAppStore.getState().rfNodes)).toEqual(resolved);
});
