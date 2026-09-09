import { describe, expect, it } from 'vitest';
import type { DiscoveredEndpoint } from '../../../types';
import { endpointHardwareDetails, endpointSubtitle, endpointTypeLabel, isEndpointApplied } from '../discoveredEndpoints';

function endpoint(patch: Record<string, unknown>, metadata: Record<string, unknown> = {}): DiscoveredEndpoint {
  return {
    adapterId: 'serial',
    discoveryId: '/dev/ttyUSB0',
    displayName: 'USB Serial',
    configurationPatch: patch,
    metadata,
  };
}

describe('isEndpointApplied', () => {
  it('is true when every patch value matches the payload', () => {
    expect(isEndpointApplied(
      endpoint({ port_name: '/dev/ttyUSB0' }),
      { port_name: '/dev/ttyUSB0', baud_rate: 115200 },
    )).toBe(true);
  });

  it('is false when a patch value differs from the payload', () => {
    expect(isEndpointApplied(
      endpoint({ port_name: '/dev/ttyUSB0' }),
      { port_name: '/dev/ttyUSB1' },
    )).toBe(false);
  });

  it('is false when the payload is missing a patched key', () => {
    expect(isEndpointApplied(endpoint({ port_name: '/dev/ttyUSB0' }), {})).toBe(false);
  });

  it('matches nested patches partially against nested payload values', () => {
    expect(isEndpointApplied(
      endpoint({ connection: { host: '10.0.0.2' } }),
      { connection: { host: '10.0.0.2', port: 502 } },
    )).toBe(true);
    expect(isEndpointApplied(
      endpoint({ connection: { host: '10.0.0.2' } }),
      { connection: { host: '10.0.0.3', port: 502 } },
    )).toBe(false);
  });
});

describe('endpointSubtitle', () => {
  it('returns the discovery id when it differs from the display name', () => {
    expect(endpointSubtitle(endpoint({}))).toBe('/dev/ttyUSB0');
  });

  it('returns undefined when the discovery id equals the display name', () => {
    const item = { ...endpoint({}), displayName: '/dev/ttyUSB0' };
    expect(endpointSubtitle(item)).toBeUndefined();
  });
});

describe('endpointHardwareDetails', () => {
  it('formats vid and pid as uppercase hex pairs', () => {
    expect(endpointHardwareDetails(endpoint({}, { vid: 0x1a86, pid: 0x7523 })))
      .toEqual({ vidPid: '1A86:7523', serialNumber: undefined, manufacturer: undefined });
  });

  it('zero-pads short hex values', () => {
    expect(endpointHardwareDetails(endpoint({}, { vid: 0x0483, pid: 0x5740 })).vidPid)
      .toBe('0483:5740');
  });

  it('omits vidPid when either vid or pid is missing', () => {
    expect(endpointHardwareDetails(endpoint({}, { vid: 0x1a86 })).vidPid).toBeUndefined();
    expect(endpointHardwareDetails(endpoint({}, { pid: 0x7523 })).vidPid).toBeUndefined();
  });

  it('passes through serial number and manufacturer strings', () => {
    const details = endpointHardwareDetails(endpoint({}, {
      serialNumber: 'ABC123',
      manufacturer: 'wch.cn',
    }));
    expect(details.serialNumber).toBe('ABC123');
    expect(details.manufacturer).toBe('wch.cn');
  });

  it('returns all undefined for empty metadata', () => {
    expect(endpointHardwareDetails(endpoint({})))
      .toEqual({ vidPid: undefined, serialNumber: undefined, manufacturer: undefined });
  });
});

describe('endpointTypeLabel', () => {
  it('explains system-reported Bluetooth ports without inventing USB IDs', () => {
    const item = endpoint({}, { portType: 'Bluetooth', description: 'Headset' });
    expect(endpointTypeLabel(item, 'zh')).toBe('蓝牙串口');
    expect(endpointHardwareDetails(item).vidPid).toBeUndefined();
  });
  it('does not infer a transport type from a port name', () => {
    expect(endpointTypeLabel(endpoint({}), 'en')).toBeUndefined();
  });
});
