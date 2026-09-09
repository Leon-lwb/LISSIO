import { api } from '../tauri/tauri';
import type { AdapterCapability } from '../../types';

let catalogRequest: Promise<AdapterCapability[]> | null = null;

export function loadAdapterCapabilities(refresh = false): Promise<AdapterCapability[]> {
  if (refresh || catalogRequest == null) {
    catalogRequest = api.listAdapterCapabilities().catch((error: unknown) => {
      catalogRequest = null;
      throw error;
    });
  }
  return catalogRequest;
}

export function resetCapabilityCatalogForTests(): void {
  catalogRequest = null;
}
