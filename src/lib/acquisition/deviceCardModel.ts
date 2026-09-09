import type {
  AdapterCapability,
  EndpointDescriptor,
} from '../../types';

/// 前端只投影后端 capability，不按协议或驱动 ID 选择 React renderer。
/// 新增适配器只要发布 EndpointDescriptor + JSON Schema，就会自动获得卡片。
export interface DeviceCardModel {
  key: string;
  adapter: AdapterCapability;
  endpoint: EndpointDescriptor;
}

export function buildDeviceCards(adapters: readonly AdapterCapability[]): DeviceCardModel[] {
  return adapters.flatMap((adapter) => adapter.endpoints.map((endpoint) => ({
    key: `${adapter.adapterId}:${endpoint.id}`,
    adapter,
    endpoint,
  })));
}
