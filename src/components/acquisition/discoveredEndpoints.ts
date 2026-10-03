import { translate, type Lang } from '../../i18n';
import type { DiscoveredEndpoint } from '../../types';

export function isEndpointApplied(
  endpoint: DiscoveredEndpoint,
  payload: Record<string, unknown>,
): boolean {
  return patchMatches(endpoint.configurationPatch, payload);
}

function patchMatches(patch: unknown, value: unknown): boolean {
  if (isObject(patch)) {
    if (!isObject(value)) return false;
    return Object.entries(patch).every(([key, child]) => patchMatches(child, value[key]));
  }
  return JSON.stringify(patch) === JSON.stringify(value);
}

export function endpointSubtitle(endpoint: DiscoveredEndpoint): string | undefined {
  return endpoint.discoveryId !== endpoint.displayName ? endpoint.discoveryId : undefined;
}

export interface EndpointHardwareDetails {
  vidPid?: string;
  serialNumber?: string;
  manufacturer?: string;
}

export function endpointHardwareDetails(endpoint: DiscoveredEndpoint): EndpointHardwareDetails {
  const metadata = endpoint.metadata ?? {};
  const vid = typeof metadata.vid === 'number' ? metadata.vid : undefined;
  const pid = typeof metadata.pid === 'number' ? metadata.pid : undefined;
  return {
    vidPid: vid != null && pid != null ? `${hex4(vid)}:${hex4(pid)}` : undefined,
    serialNumber: metadataString(metadata.serialNumber),
    manufacturer: metadataString(metadata.manufacturer),
  };
}

function hex4(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, '0');
}

function metadataString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

/** Device type comes from the backend's OS enumeration, never from its path. */
export function endpointTypeLabel(endpoint: DiscoveredEndpoint, lang: Lang): string | undefined {
  switch (endpoint.metadata?.portType) {
    case 'Bluetooth': return translate('deviceTypeBluetooth', lang);
    case 'USB': return translate('deviceTypeUsb', lang);
    case 'PCI': return translate('deviceTypePci', lang);
    case 'Unknown': return translate('deviceTypeSystem', lang);
    default: return undefined;
  }
}
