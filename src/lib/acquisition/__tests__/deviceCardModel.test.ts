import { describe, expect, it } from 'vitest';
import { buildDeviceCards } from '../deviceCardModel';
import type { AdapterCapability, CapabilitySet, PortDescriptor } from '../../../types';

const operations: CapabilitySet = {
  byteSource: false,
  byteSink: false,
  discover: true,
  browse: false,
  read: true,
  subscribe: true,
  write: true,
  method: false,
};

function port(id: string, dataDomain: string): PortDescriptor {
  return {
    id,
    displayName: id,
    direction: 'bidirectional',
    dataDomain,
    operations,
    dataTypes: [],
  };
}

function adapter(): AdapterCapability {
  return {
    contractVersion: 1,
    adapterId: 'future-driver',
    displayName: 'Future Driver',
    protocol: 'future-protocol-not-known-by-the-frontend',
    transport: 'future-transport',
    direction: 'peer',
    operations,
    dataDomains: ['points', 'future-domain'],
    endpoints: [
      {
        id: 'primary',
        displayName: 'Primary',
        transport: 'future-transport',
        direction: 'peer',
        status: { state: 'experimental' },
        ports: [port('points', 'points'), port('events', 'future-domain')],
        configuration: {
          schemaVersion: 3,
          jsonSchema: { type: 'object' },
          uiHints: {},
        },
      },
      {
        id: 'secondary',
        displayName: 'Secondary',
        transport: 'future-transport',
        direction: 'server',
        status: { state: 'available' },
        ports: [],
        configuration: {
          schemaVersion: 4,
          jsonSchema: { type: 'object' },
          uiHints: {},
        },
      },
    ],
  };
}

describe('backend-driven device card model', () => {
  it('creates one card per endpoint without knowing its protocol, transport, or data domain', () => {
    const cards = buildDeviceCards([adapter()]);
    expect(cards.map(({ key }) => key)).toEqual([
      'future-driver:primary',
      'future-driver:secondary',
    ]);
    expect(cards[0].endpoint.ports.map(({ id }) => id)).toEqual(['points', 'events']);
    expect(cards[1].endpoint.configuration.schemaVersion).toBe(4);
  });
});
