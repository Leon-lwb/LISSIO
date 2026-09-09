import { describe, expect, it } from 'vitest';
import type { DeviceCardModel } from '../../../lib/acquisition/deviceCardModel';
import type { DiscoveredEndpoint } from '../../../types';
import { groupDevices } from '../devicePanelModel';

function card(id: string): DeviceCardModel {
  const endpoint = { id: 'main', displayName: id, transport: 'serial', direction: 'peer',
    status: { state: 'available' }, ports: [], configuration: { schemaVersion: 1, jsonSchema: {}, uiHints: {} } };
  return { key: id, endpoint, adapter: { adapterId: id, displayName: id, contractVersion: 1,
    protocol: id, transport: 'serial', direction: 'peer', dataDomains: [], endpoints: [endpoint],
    operations: { discover: true, byteSource: true, byteSink: true, browse: false, read: false, subscribe: false, write: false, method: false } } };
}
function endpoint(adapterId: string, id?: string, path = 'COM3'): DiscoveredEndpoint {
  return { adapterId, discoveryId: path, displayName: 'USB Serial',
    configurationPatch: adapterId === 'rtu' ? { portName: path } : { port_name: path },
    metadata: { deviceId: id, vid: 0x1234, pid: 0x5678, serialNumber: 'same' } };
}

describe('groupDevices', () => {
  it('merges cross-adapter discoveries only by explicit identity and retains patches', () => {
    const devices = groupDevices([card('serial'), card('rtu')], {
      serial: [endpoint('serial', 'serial:COM3'), endpoint('serial', 'serial:COM3')],
      rtu: [endpoint('rtu', 'serial:COM3')],
    });
    expect(devices).toHaveLength(1);
    expect(devices[0].options).toHaveLength(2);
    expect(devices[0].options[1].endpoint.configurationPatch).toEqual({ portName: 'COM3' });
  });
  it('orders numbered ports naturally', () => {
    const devices = groupDevices([card('serial')], { serial: [endpoint('serial', 'serial:COM10', 'COM10'), endpoint('serial', 'serial:COM2', 'COM2')] });
    expect(devices.map((device) => device.id)).toEqual(['serial:COM2', 'serial:COM10']);
  });
  it('keeps identical hardware on separate interfaces and unknown identities separate', () => {
    expect(groupDevices([card('serial')], { serial: [endpoint('serial', 'serial:COM3'), endpoint('serial', 'serial:COM4', 'COM4')] })).toHaveLength(2);
    expect(groupDevices([card('serial'), card('rtu')], { serial: [endpoint('serial')], rtu: [endpoint('rtu')] })).toHaveLength(2);
  });
});
