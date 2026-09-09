import type { DeviceCardModel } from '../../lib/acquisition/deviceCardModel';
import type { DiscoveredEndpoint } from '../../types';

export interface DeviceOption { card: DeviceCardModel; endpoint: DiscoveredEndpoint }
export interface PanelDevice { id: string; options: DeviceOption[] }

/** Only backend-provided identity may join discoveries from different adapters. */
export function groupDevices(cards: DeviceCardModel[], discoveries: Record<string, DiscoveredEndpoint[]>): PanelDevice[] {
  const devices = new Map<string, PanelDevice>();
  for (const card of cards) {
    if (card.endpoint.status.state === 'unavailable') continue;
    for (const endpoint of discoveries[card.adapter.adapterId] ?? []) {
      const identity = endpoint.metadata.deviceId;
      const id = typeof identity === 'string' && identity.trim()
        ? identity : JSON.stringify([card.adapter.adapterId, endpoint.discoveryId]);
      const device = devices.get(id) ?? { id, options: [] };
      if (!device.options.some((option) => option.card.key === card.key)) device.options.push({ card, endpoint });
      devices.set(id, device);
    }
  }
  return [...devices.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function adapterLabel(card: DeviceCardModel): string {
  return card.adapter.endpoints.length === 1 ? card.adapter.displayName : card.endpoint.displayName;
}
