import type { Node } from '@xyflow/react';
import type { DeviceTreeNodeDecl, ProtocolConfig, ProtocolSchema, WidgetConfig } from '../../types';
import type { AcquisitionNodeData } from '../acquisition/acquisitionNodes';
import type { ProtocolNodeData } from '../../store/appStoreHelpers';
import { customWidgetPortDeclaration } from '../utils/nodeDef';
import { schemaPortNames } from '../utils/protocolSchema';

type Business =
  | { kind: 'device'; config: { node: DeviceTreeNodeDecl } }
  | { kind: 'protocol'; config: { protocol: ProtocolConfig; convertTo: ProtocolConfig | null; schema: ProtocolSchema } }
  | { kind: 'pointSelector'; config: { points: string[] } }
  | { kind: 'widget'; config: { widgetKind: WidgetConfig['kind']; params: Record<string, unknown>; customPorts: { inputs: string[]; outputs: string[] } | null } };

export type NodeDocument = Business & {
  id: string;
  tabId: string;
  label: string;
  layout: { x: number; y: number; width: number | null; height: number | null };
};

export function nodeDocument(node: Node): NodeDocument {
  let business: Business;
  let label = typeof node.data.label === 'string' ? node.data.label : '';
  switch (node.type) {
    case 'acquisition': {
      const { node: device } = node.data as AcquisitionNodeData;
      business = { kind: 'device', config: { node: device } };
      label = device.name;
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
      const customPorts = widget.kind === 'Custom' ? customWidgetPortDeclaration(widget) : null;
      business = { kind: 'widget', config: { widgetKind: widget.kind, params, customPorts } };
      break;
    }
    default: throw new Error(`Unknown node kind: ${node.type}`);
  }
  return {
    id: node.id,
    tabId: node.data.tabId as string,
    label,
    layout: { ...node.position, width: node.width ?? null, height: node.height ?? null },
    ...business,
  };
}

export function canvasNode(doc: NodeDocument, previous?: Node): Node {
  const base = {
    id: doc.id,
    position: { x: doc.layout.x, y: doc.layout.y },
    width: doc.layout.width ?? undefined,
    height: doc.layout.height ?? undefined,
    selected: previous?.selected,
    data: { tabId: doc.tabId, label: doc.label },
  };
  switch (doc.kind) {
    case 'device': return {
      ...base,
      type: 'acquisition',
      data: {
        ...base.data,
        node: { ...doc.config.node, id: doc.id, name: doc.label },
        card: previous?.data.card,
        ports: previous?.data.ports,
      },
    };
    case 'protocol': return { ...base, type: 'protocol', data: { ...base.data, config: doc.config.protocol, convertTo: doc.config.convertTo,
      schema: doc.config.schema, channels: schemaPortNames(doc.config.schema?.decode ?? []).length } };
    case 'pointSelector': return { ...base, type: 'point-selector', data: { ...base.data, points: doc.config.points } };
    case 'widget': return { ...base, type: 'widget', data: { ...base.data,
      widget: { kind: doc.config.widgetKind, params: { ...doc.config.params, id: doc.id, label: doc.label } } } };
  }
}
