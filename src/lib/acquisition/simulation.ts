import { openNodePropertiesPanel } from '../utils/revealDataTab';
import type { Node, Edge } from '@xyflow/react';
import type {
  EncodeBlock,
  ProtocolConfig,
  ProtocolSchema,
  SimulationConfig,
  WidgetConfig,
} from '../../types';
import type { ProtocolNodeData } from '../../store/appStoreHelpers';
import { simulationConfig, updateAcquisitionNode, withSimulation, type AcquisitionNodeData } from './acquisitionNodes';
import { useAppStore } from '../../store/appStore';
import { deviceTreeCanvasEdges, deviceTreeCanvasNodes } from './deviceTreeModel';

export const defaultSimulation = (): SimulationConfig => ({
  signal: { waveform: 'sine', frequency: 1, amplitude: 1, offset: 0 },
  sampleRate: 100, seed: 1, channels: 4, overrides: {}, referenceNodeId: null, encoding: null,
});

export function downstreamParsers(device: Node, nodes: Node[], edges: Edge[]): Node[] {
  const allNodes = [...nodes, ...deviceTreeCanvasNodes(nodes)];
  const allEdges = [...edges, ...deviceTreeCanvasEdges(nodes)];
  const visited = new Set([device.id]);
  const queue = [device.id];
  const parsers: Node[] = [];
  while (queue.length) {
    const source = queue.shift();
    for (const edge of allEdges.filter(e => e.source === source && ['rx', 'out', 'raw'].includes(e.sourceHandle ?? '') && e.targetHandle === 'in')) {
      const target = allNodes.find(n => n.id === edge.target && n.data.tabId === device.data.tabId && n.data.enabled !== false);
      if (!target || visited.has(target.id)) continue;
      visited.add(target.id);
      if (target.type === 'protocol' || (target.data.widget as { kind?: string } | undefined)?.kind === 'FrameDecoder') parsers.push(target);
      else queue.push(target.id);
    }
  }
  return parsers;
}

export function resolveSimulation(device: Node, nodes: Node[], edges: Edge[]): SimulationConfig | null {
  const data = device.data as AcquisitionNodeData;
  const simulation = simulationConfig(data.node);
  if (!simulation) return null;
  if (data.ports?.some(p => p.domain === 'points')) return simulation;
  const parsers = downstreamParsers(device, nodes, edges);
  let parser = parsers.find(p => p.id === simulation.referenceNodeId);
  if (!parser && parsers.length) {
    const formats = new Set(parsers.map(p => JSON.stringify([p.data.config, p.data.schema, p.data.widget])));
    if (formats.size > 1) throw new Error('存在多种解析格式，请选择参考解析器。');
    parser = parsers[0];
  }
  const encoding = parser ? parserEncoding(parser) : simulation.encoding;
  if (!encoding) throw new Error('请选择生成格式；自定义解析器需要配置编码规则。');
  const schema = (encoding as { schema?: ProtocolSchema }).schema;
  if (schema?.preset === 'custom' && !schema.encode?.length) throw new Error('自定义解析器缺少编码规则。');
  return { ...simulation, encoding: encoding as SimulationConfig['encoding'] };
}

function parserEncoding(parser: Node): { protocol: ProtocolConfig; schema: ProtocolSchema } | null {
  if (parser.type === 'protocol') {
    const data = parser.data as ProtocolNodeData;
    return { protocol: data.config, schema: data.schema };
  }
  const widget = parser.data.widget as WidgetConfig | undefined;
  if (widget?.kind !== 'FrameDecoder') return null;
  const config = widget.params;
  const encode: EncodeBlock[] = [];
  for (const block of config.blocks) {
    if ((block.type === 'header' || block.type === 'tail') && block.matchId == null) {
      encode.push({ type: 'constHex', params: { hex: block.hex } });
    } else if (block.type === 'field' && block.matchId == null && block.lengthRef == null && block.fieldType !== 'bytes') {
      encode.push({ type: 'varRef', params: { portName: block.portName, fieldType: block.fieldType } });
    } else if (block.type === 'checksum' && block.matchId == null && block.cover === 'all_prior' && block.position !== 'prepend') {
      encode.push({ type: 'checksum', params: { algorithm: block.algorithm, customScript: block.customScript } });
    } else {
      return null;
    }
  }
  return {
    protocol: { kind: 'RawData' },
    schema: { preset: 'custom', presetConfig: null, decode: config.blocks, encode },
  };
}

/** Attributes never create nodes; repeated application only selects the existing device. */
export function applyTestAttribute(nodeId?: string): boolean {
  const state = useAppStore.getState();
  const selected = state.rfNodes.filter(n => n.selected && n.data.tabId === state.activeControlTabId);
  const node = nodeId ? state.rfNodes.find(n => n.id === nodeId) : selected.length === 1 ? selected[0] : undefined;
  if (node?.type !== 'acquisition') return false;
  const { node: device } = node.data as AcquisitionNodeData;
  if (!simulationConfig(device)) {
    const existing = device.children.find(child => child.driver === 'simulation');
    const updated = existing ? { ...device, children: device.children.map(child => child.id === existing.id
      ? { ...child, enabled: true } : child) } : withSimulation(device, defaultSimulation());
    updateAcquisitionNode(node.id, updated);
  }
  state.onNodesChange(state.rfNodes.map(n => ({ id: n.id, type: 'select', selected: n.id === node.id })));
  openNodePropertiesPanel();
  return true;
}
