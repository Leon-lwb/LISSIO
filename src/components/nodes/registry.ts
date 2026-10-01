import type { ComponentType } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import type { DomainType } from '../../types';
import type { DerivedPort, NodePortTable, PortInfo } from '../../lib/utils/connectionRules';
import { getDescribeEntry, describeDomainToUi } from '../../lib/models/describeStore';
import type { AcquisitionNodeData } from '../../lib/acquisition/acquisitionNodes';
import { WidgetNode } from './WidgetNode';
import { AcquisitionNode } from './AcquisitionNode';
import { PointSelectorNode, PointSelectorProperties } from './PointSelectorNode';
import { ProtocolNode } from './ProtocolNode';
import { WidgetProperties } from './WidgetProperties';
import { AcquisitionProperties } from '../acquisition/AcquisitionProperties';
import { ProtocolProperties } from './ProtocolProperties';

export type CanvasNodeType = 'acquisition' | 'point-selector' | 'protocol' | 'widget';
interface PropertyProps { node: Node }
interface PortContext {
  derivedPorts?: Record<string, { ports?: DerivedPort[] }>;
  detectedChannels?: Record<string, number | null>;
}

/// 节点类型的三个消费者: React Flow 渲染 (renderer)、属性面板 (properties)、
/// 连线校验/AI 端口暴露 (ports)。尺寸限制统一走 `widgetMinSize` (WidgetNode
/// 自取), 本表不再重复声明 — 曾经的 `size()` 与 `NODE_REGISTRY` 导出无消费者,
/// 已随本次加载面规范化删除。
export interface NodeDefinition {
  renderer: ComponentType<NodeProps>;
  properties: ComponentType<PropertyProps>;
  ports(node: Node, context: PortContext): NodePortTable;
}

const domain = (value: string): DomainType =>
  value === 'points' ? 'points' : value === 'bytes' ? 'bytes' : value === 'string' ? 'string' : 'time';

/// 描述端口 → 前端端口表 (NodePortDomain wire 与 graph:derived 同源)
function describePorts(nodeId: string): NodePortTable {
  const description = getDescribeEntry(nodeId).description;
  if (!description) return { inputs: [], outputs: [] };
  const toUi = (ports: typeof description.inputs): PortInfo[] =>
    ports.map((port) => ({ id: port.handle, domain: describeDomainToUi(port.domain) }));
  return { inputs: toUi(description.inputs), outputs: toUi(description.outputs) };
}

const definitions: Record<CanvasNodeType, NodeDefinition> = {
  acquisition: {
    renderer: AcquisitionNode,
    properties: AcquisitionProperties,
    ports(node) {
      const ports = (node.data as AcquisitionNodeData).ports ?? [];
      const map = (port: typeof ports[number]) => ({ id: port.id, domain: domain(port.domain) });
      return {
        inputs: ports.filter(port => port.direction !== 'output').map(map),
        outputs: ports.filter(port => port.direction !== 'input').map(map),
      };
    },
  },
  'point-selector': {
    renderer: PointSelectorNode,
    properties: PointSelectorProperties,
    ports: node => ({
      inputs: [{ id: 'points', domain: 'points' }],
      outputs: (node.data.points as string[]).map(id => ({ id, domain: 'time' })),
    }),
  },
  protocol: {
    renderer: ProtocolNode,
    properties: ProtocolProperties,
    ports(node, context) {
      // 运行时检测的派生端口 (graph:derived) 优先; 静态模型视图来自
      // describe_node_documents — 前端不再本地派生协议端口
      const derived = context.derivedPorts?.[node.id]?.ports;
      const names: PortInfo[] = derived?.length
        ? derived.map(port => ({ id: port.name, domain: port.domain === 'Spectrum' ? 'freq' : port.domain === 'String' ? 'string' : 'time' }))
        : describePorts(node.id).outputs;
      return { inputs: [{ id: 'in', domain: 'bytes' }], outputs: [{ id: 'out', domain: 'bytes' }, ...names] };
    },
  },
  widget: {
    renderer: WidgetNode,
    properties: WidgetProperties,
    ports: node => describePorts(node.id),
  },
};

export function nodeDefinition(node: Node): NodeDefinition {
  const definition = node.type && definitions[node.type as CanvasNodeType];
  if (!definition) throw new Error(`Unregistered node type: ${node.type ?? '<none>'}`);
  return definition;
}

export const REACT_FLOW_NODE_TYPES = Object.fromEntries(
  Object.entries(definitions).map(([kind, definition]) => [kind, definition.renderer]),
);
