import type { ComponentType } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import type { DomainType, WidgetConfig } from '../../types';
import type { DerivedPort, NodePortTable } from '../../lib/utils/connectionRules';
import { getWidgetPorts } from './WidgetPorts';
import { widgetMinSize, type WidgetSizeLimits } from '../../lib/utils/widgetSize';
import { isRawDataPreset, protocolPortNames } from '../../lib/utils/protocolSchema';
import type { ProtocolNodeData } from '../../store/appStoreHelpers';
import type { AcquisitionNodeData } from '../../lib/acquisition/acquisitionNodes';
import { WidgetNode } from './WidgetNode';
import { AcquisitionNode } from './AcquisitionNode';
import { PointSelectorNode, PointSelectorProperties } from './PointSelectorNode';
import { ProtocolNode } from './ProtocolNode';
import { WidgetProperties } from './WidgetProperties';
import { AcquisitionProperties } from '../acquisition/AcquisitionProperties';
import { ProtocolProperties } from './ProtocolProperties';

export type CanvasNodeType = 'acquisition' | 'point-selector' | 'protocol' | 'widget';
type PropertyProps = { node: Node };
type PortContext = {
  derivedPorts?: Record<string, { ports?: DerivedPort[] }>;
  detectedChannels?: Record<string, number | null>;
};

export interface NodeDefinition {
  renderer: ComponentType<NodeProps>;
  properties: ComponentType<PropertyProps>;
  ports(node: Node, context: PortContext): NodePortTable;
  size(node: Node): WidgetSizeLimits;
}

const domain = (value: string): DomainType =>
  value === 'points' ? 'points' : value === 'bytes' ? 'bytes' : value === 'string' ? 'string' : 'time';

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
    size: () => ({ minW: 180, minH: 90 }),
  },
  'point-selector': {
    renderer: PointSelectorNode,
    properties: PointSelectorProperties,
    ports: node => ({
      inputs: [{ id: 'points', domain: 'points' }],
      outputs: (node.data.points as string[]).map(id => ({ id, domain: 'time' })),
    }),
    size: () => ({ minW: 180, minH: 90 }),
  },
  protocol: {
    renderer: ProtocolNode,
    properties: ProtocolProperties,
    ports(node, context) {
      const data = node.data as ProtocolNodeData;
      const derived = context.derivedPorts?.[node.id]?.ports;
      const names = derived?.length
        ? derived.map(port => ({ id: port.name, domain: port.domain === 'Spectrum' ? 'freq' : port.domain === 'String' ? 'string' : 'time' as DomainType }))
        : protocolPortNames(data, context.detectedChannels?.[node.id] ?? null)
          .map(id => ({ id, domain: isRawDataPreset(data) && id === 'str' ? 'string' : 'time' as DomainType }));
      return { inputs: [{ id: 'in', domain: 'bytes' }], outputs: [{ id: 'out', domain: 'bytes' }, ...names] };
    },
    size: () => ({ minW: 180, minH: 90 }),
  },
  widget: {
    renderer: WidgetNode,
    properties: WidgetProperties,
    ports(node) {
      const widget = node.data.widget as WidgetConfig;
      if (widget.kind === 'RawData') return { inputs: [], outputs: [] };
      return getWidgetPorts(widget);
    },
    size: node => widgetMinSize((node.data.widget as WidgetConfig).kind),
  },
};

export const NODE_REGISTRY = definitions;

export function nodeDefinition(node: Node): NodeDefinition {
  const definition = node.type && definitions[node.type as CanvasNodeType];
  if (!definition) throw new Error(`Unregistered node type: ${node.type ?? '<none>'}`);
  return definition;
}

export const REACT_FLOW_NODE_TYPES = Object.fromEntries(
  Object.entries(definitions).map(([kind, definition]) => [kind, definition.renderer]),
);
