import type { Node } from '@xyflow/react';
import type { DriverPayload, ProtocolConfig, ProtocolSchema, SimulationConfig, WidgetConfig } from '../../types';
import type { AcquisitionNodeData } from '../acquisition/acquisitionNodes';
import type { ProtocolNodeData } from '../../store/appStoreHelpers';
import { widgetToNodeKind } from '../utils/nodeDef';
import { getEffectiveChannels } from '../utils/protocolSchema';

type Business =
  | { kind: 'device'; config: { enabled: boolean; capabilityEndpointId?: string | null; driver: DriverPayload } }
  | { kind: 'protocol'; config: { protocol: ProtocolConfig; convertTo: ProtocolConfig | null; schema: ProtocolSchema } }
  | { kind: 'pointSelector'; config: { points: string[] } }
  | { kind: 'widget'; config: { widgetKind: WidgetConfig['kind']; params: Record<string, unknown>; customPorts: { inputs: string[]; outputs: string[] } | null } };

export type NodeDocument = Business & {
  id: string;
  tabId: string;
  label: string;
  layout: { x: number; y: number; width: number | null; height: number | null };
  attributes: { testData: SimulationConfig | null };
};

export function nodeDocument(node: Node): NodeDocument {
  let business: Business;
  let label = String(node.data.label ?? '');
  let testData: SimulationConfig | null = null;
  switch (node.type) {
    case 'acquisition': {
      const { spec } = node.data as AcquisitionNodeData;
      business = { kind: 'device', config: { enabled: spec.enabled, capabilityEndpointId: spec.capabilityEndpointId, driver: spec.driver } };
      label = spec.label; testData = spec.simulation ?? null;
      break;
    }
    case 'protocol': {
      const data = node.data as ProtocolNodeData;
      business = { kind: 'protocol', config: { protocol: data.config, convertTo: data.convertTo, schema: data.schema } };
      break;
    }
    case 'point-selector': business = { kind: 'pointSelector', config: { points: node.data.points as string[] } }; break;
    case 'widget': {
      const widget = node.data.widget as WidgetConfig;
      const { id: _id, label: widgetLabel, ...params } = widget.params;
      label = widgetLabel;
      const lowered = widget.kind === 'Custom' ? widgetToNodeKind(widget) : null;
      business = { kind: 'widget', config: { widgetKind: widget.kind, params, customPorts: lowered?.kind === 'Custom' ? lowered.params : null } };
      break;
    }
    default: throw new Error(`Unknown node kind: ${node.type}`);
  }
  return { id: node.id, tabId: node.data.tabId as string, label,
    layout: { ...node.position, width: node.width ?? null, height: node.height ?? null },
    attributes: { testData }, ...business };
}

export function canvasNode(doc: NodeDocument, previous?: Node): Node {
  const base = { id: doc.id, position: { x: doc.layout.x, y: doc.layout.y }, width: doc.layout.width ?? undefined,
    height: doc.layout.height ?? undefined, selected: previous?.selected, data: { tabId: doc.tabId, label: doc.label } };
  switch (doc.kind) {
    case 'device': return { ...base, type: 'acquisition', data: { ...base.data,
      spec: { ...doc.config, id: doc.id, label: doc.label, simulation: doc.attributes.testData },
      card: previous?.data.card, ports: previous?.data.ports,
    } };
    case 'protocol': return { ...base, type: 'protocol', data: { ...base.data, config: doc.config.protocol, convertTo: doc.config.convertTo,
      schema: doc.config.schema, channels: getEffectiveChannels(doc.config.protocol, null) } };
    case 'pointSelector': return { ...base, type: 'point-selector', data: { ...base.data, points: doc.config.points } };
    case 'widget': return { ...base, type: 'widget', data: { ...base.data,
      widget: { kind: doc.config.widgetKind, params: { ...doc.config.params, id: doc.id, label: doc.label } } } };
  }
}
