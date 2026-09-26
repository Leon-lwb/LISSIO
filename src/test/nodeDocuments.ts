import type { Node } from '@xyflow/react';
import type { NodeDocument } from '../lib/nodes/document';
import { canvasNode, nodeDocument } from '../lib/nodes/document';
import { createWidget } from '../lib/utils/widgetDefaults';
import { schemaFromProtocolConfig } from '../lib/utils/protocolSchema';

export function deviceDocument(id = 'device', tabId = 'default'): NodeDocument {
  return {
    id,
    tabId,
    label: 'Serial device',
    kind: 'device',
    layout: { x: 40, y: 60, width: 220, height: null },
    config: {
      node: {
        id,
        name: 'Serial device',
        driver: 'serial',
        schemaVersion: 1,
        config: { port_name: '', baud_rate: 115200, data_bits: 8, parity: 'none', stop_bits: 'one', flow_control: 'none' },
        enabled: true,
        capabilityEndpointId: 'device',
        children: [{
          id: `${id}::simulation`,
          name: 'simulation',
          driver: 'simulation',
          schemaVersion: 1,
          config: {
            signal: { waveform: 'sine', frequency: 1, amplitude: 1, offset: 0 },
            sampleRate: 100, seed: 1, channels: 4, overrides: {}, referenceNodeId: null, encoding: null,
          },
          enabled: true,
          children: [],
        }],
      },
    },
  };
}

export function protocolDocument(id = 'parser', tabId = 'default'): NodeDocument {
  const protocol = { kind: 'JustFloat', channels: null } as const;
  return { id, tabId, label: 'Parser', kind: 'protocol', layout: { x: 320, y: 60, width: null, height: null },
    config: { protocol, convertTo: null, schema: schemaFromProtocolConfig(protocol) } };
}

export function widgetDocument(id = 'widget', tabId = 'default'): NodeDocument {
  const widget = createWidget('NumberDisplay');
  widget.params.id = id;
  return nodeDocument({ id, type: 'widget', position: { x: 580, y: 60 }, data: { tabId, widget } });
}

export function documentNodes(): Node[] {
  return [deviceDocument(), protocolDocument(), widgetDocument()].map(doc => canvasNode(doc));
}
