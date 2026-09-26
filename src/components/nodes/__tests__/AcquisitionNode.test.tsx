import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { NodeProps } from '@xyflow/react';
import type { AdapterCapability, CapabilitySet } from '../../../types';
import { useAppStore } from '../../../store/appStore';

const mocks = vi.hoisted(() => ({
  loadAdapterCapabilities: vi.fn<() => Promise<AdapterCapability[]>>(),
  updateNodeInternals: vi.fn(),
}));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Handle: ({ id, type }: { id?: string; type?: string }) => (
      <span data-testid={`${type}-${id}`} />
    ),
    useUpdateNodeInternals: () => mocks.updateNodeInternals,
  };
});

vi.mock('../../../lib/acquisition/capabilityCatalog', () => ({
  loadAdapterCapabilities: mocks.loadAdapterCapabilities,
}));

vi.mock('../../../lib/acquisition/useDeviceNodeSnapshot', () => ({
  useDeviceNodeSnapshot: () => undefined,
}));

import { AcquisitionNode } from '../AcquisitionNode';
import { buildDeviceCards } from '../../../lib/acquisition/deviceCardModel';

const operations: CapabilitySet = {
  byteSource: false,
  byteSink: false,
  discover: false,
  browse: false,
  read: true,
  subscribe: true,
  write: true,
  method: false,
};

function adapter(): AdapterCapability {
  return {
    contractVersion: 1,
    adapterId: 'modbus-rtu',
    displayName: 'Modbus RTU',
    protocol: 'modbus-rtu',
    transport: 'serial',
    direction: 'client',
    operations,
    dataDomains: ['points'],
    display: null,
    endpoints: [{
      id: 'serial-client',
      displayName: 'Modbus RTU device',
      transport: 'serial',
      direction: 'client',
      status: { state: 'available', detail: null },
      ports: [
        { id: 'request', displayName: 'Request', direction: 'input', dataDomain: 'points', operations, dataTypes: [], addressSpace: null, display: null },
        { id: 'points', displayName: 'Points', direction: 'bidirectional', dataDomain: 'points', operations, dataTypes: [], addressSpace: null, display: null },
        { id: 'events', displayName: 'Events', direction: 'output', dataDomain: 'points', operations, dataTypes: [], addressSpace: null, display: null },
      ],
      configuration: { schemaVersion: 1, jsonSchema: { type: 'object' }, uiHints: null }, display: null,
    }],
  };
}

function data(withCard = true) {
  return {
    tabId: 'default',
    label: 'Modbus RTU',
    node: {
      id: 'acquisition-1',
      name: 'Modbus RTU',
      driver: 'modbus-rtu',
      schemaVersion: 1,
      config: {},
      enabled: true,
      capabilityEndpointId: 'serial-client',
      children: [],
    },
    card: withCard ? buildDeviceCards([adapter()])[0] : undefined,
  };
}

describe('AcquisitionNode ports', () => {
  beforeEach(() => {
    mocks.loadAdapterCapabilities.mockReset();
    mocks.updateNodeInternals.mockReset();
    useAppStore.setState({ rfEdges: [] });
  });

  it('renders every backend port on the side declared by its direction', () => {
    render(<AcquisitionNode {...({ id: 'acquisition-1', data: data() } as unknown as NodeProps)} />);

    expect(screen.getByTestId('target-request')).toBeInTheDocument();
    expect(screen.queryByTestId('source-request')).not.toBeInTheDocument();
    expect(screen.getByTestId('target-points')).toBeInTheDocument();
    expect(screen.getByTestId('source-points')).toBeInTheDocument();
    expect(screen.getByTestId('source-events')).toBeInTheDocument();
    expect(screen.queryByTestId('target-events')).not.toBeInTheDocument();
  });

  it('restores ports from the backend catalog when a persisted node has no cached card', async () => {
    mocks.loadAdapterCapabilities.mockResolvedValue([adapter()]);
    render(<AcquisitionNode {...({ id: 'acquisition-1', data: data(false) } as unknown as NodeProps)} />);

    await waitFor(() => expect(screen.getByTestId('source-points')).toBeInTheDocument());
    expect(mocks.loadAdapterCapabilities).toHaveBeenCalledOnce();
    expect(mocks.updateNodeInternals).toHaveBeenCalledWith('acquisition-1');
  });
});
