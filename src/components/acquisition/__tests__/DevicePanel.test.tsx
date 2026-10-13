import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n } from '../../../test/renderWithI18n';
import type { DeviceCardModel } from '../../../lib/acquisition/deviceCardModel';
import type { DiscoveredEndpoint } from '../../../types';
import { addAcquisitionNode } from '../../../lib/acquisition/acquisitionNodes';
import { DevicePanel } from '../DevicePanel';

const operations = { discover: true, byteSource: true, byteSink: true, browse: false,
  read: false, subscribe: false, write: false, method: false };
const card = (id: string, displayName: string): DeviceCardModel => {
  const endpoint = { id: 'main', displayName, transport: 'serial', direction: 'peer',
    status: { state: 'available' as const, detail: null }, ports: [],
    configuration: { schemaVersion: 1, jsonSchema: {}, uiHints: null }, display: null };
  return { key: id, endpoint, adapter: { adapterId: id, displayName, contractVersion: 1,
    protocol: id, transport: 'serial', direction: 'peer', dataDomains: [], endpoints: [endpoint], operations, display: null } };
};
const cards = [card('modbus-rtu', 'Modbus RTU'), card('serial', 'Serial')];
const endpoint = (adapterId: string): DiscoveredEndpoint => ({
  adapterId, discoveryId: '/dev/ttyS0', displayName: '/dev/ttyS0',
  configurationPatch: adapterId === 'serial' ? { port_name: '/dev/ttyS0' } : { portName: '/dev/ttyS0' },
  metadata: { deviceId: 'serial:/dev/ttyS0', portType: 'Unknown' },
});
vi.mock('../useDeviceDiscovery', () => ({ useDeviceDiscovery: () => ({
  discoveries: { 'modbus-rtu': [endpoint('modbus-rtu')], serial: [endpoint('serial')] },
  pending: false, errors: [], refresh: vi.fn(),
}) }));
vi.mock('../../../lib/acquisition/acquisitionNodes', () => ({ addAcquisitionNode: vi.fn(() => Promise.resolve()) }));

it('uses app-rendered choices for a discovered serial interface and adds the chosen adapter patch', async () => {
  const user = userEvent.setup();
  const { container } = renderWithI18n(<DevicePanel cards={cards} query="" />);
  const picker = screen.getByRole('combobox', { name: /ttyS0/ });
  expect(picker).toHaveTextContent('Modbus RTU');
  expect(container.querySelector('select')).toBeNull();
  await user.click(picker);
  await user.click(screen.getByRole('option', { name: 'Serial' }));
  await user.click(screen.getByRole('button', { name: /\/dev\/ttyS0/ }));
  expect(addAcquisitionNode).toHaveBeenCalledWith(cards[1], expect.any(Object), undefined,
    expect.objectContaining({ adapterId: 'serial', configurationPatch: { port_name: '/dev/ttyS0' } }));
});
