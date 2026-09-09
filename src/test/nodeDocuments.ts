import type { Node } from '@xyflow/react';
import type { NodeDocument } from '../lib/nodes/document';
import { canvasNode, nodeDocument } from '../lib/nodes/document';
import { createWidget } from '../lib/utils/widgetDefaults';
import { schemaFromProtocolConfig } from '../lib/utils/protocolSchema';
import { defaultSimulation } from '../lib/acquisition/simulation';

export function deviceDocument(id = 'device', tabId = 'default'): NodeDocument {
  return { id, tabId, label: 'Serial device', kind: 'device', layout: { x: 40, y: 60, width: 220, height: null },
    config: { enabled: true, capabilityEndpointId: 'device', driver: { driverId: 'serial', schemaVersion: 1, payload: { port_name: '', baud_rate: 115200, data_bits: 8, parity: 'none', stop_bits: 'one', flow_control: 'none' } } },
    attributes: { testData: defaultSimulation() } };
}

export function protocolDocument(id = 'parser', tabId = 'default'): NodeDocument {
  const protocol = { kind: 'JustFloat', channels: null } as const;
  return { id, tabId, label: 'Parser', kind: 'protocol', layout: { x: 320, y: 60, width: null, height: null },
    config: { protocol, convertTo: null, schema: schemaFromProtocolConfig(protocol) }, attributes: { testData: null } };
}

export function widgetDocument(id = 'widget', tabId = 'default'): NodeDocument {
  const widget = createWidget('NumberDisplay');
  widget.params.id = id;
  return nodeDocument({ id, type: 'widget', position: { x: 580, y: 60 }, data: { tabId, widget } });
}

export function documentNodes(): Node[] {
  return [deviceDocument(), protocolDocument(), widgetDocument()].map(doc => canvasNode(doc));
}
