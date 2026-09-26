import { api } from '../tauri/tauri';
import { useModelCatalogStore } from '../../store/modelCatalogStore';
import type { AdapterCapability } from '../../types';

// 模块级缓存与连接代际绑定: configure/disconnect 每次 bumpGeneration 后,
// 旧连接的 Promise 不得再返回 (重连/换服务后重新发现设备)。
let catalogRequest: Promise<AdapterCapability[]> | null = null;
let catalogGeneration = -1;

export function loadAdapterCapabilities(refresh = false): Promise<AdapterCapability[]> {
  const generation = useModelCatalogStore.getState().generation;
  if (refresh || catalogRequest == null || catalogGeneration !== generation) {
    catalogRequest = api.listAdapterCapabilities().catch((error: unknown) => {
      if (catalogGeneration === generation) catalogRequest = null;
      throw error;
    });
    catalogGeneration = generation;
  }
  return catalogRequest;
}

export function resetCapabilityCatalogForTests(): void {
  catalogRequest = null;
  catalogGeneration = -1;
}
