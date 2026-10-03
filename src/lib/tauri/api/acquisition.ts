import { transport } from '../../rpc';

import type {
  AcquisitionIntent,
  AdapterCapability,
  DeviceTreeNodeSnapshot,
  DiscoveredEndpoint,
  DriverManifestProjection,
  DriverPayload,
  EffectiveSubscription,
  PointDescriptor,
  PointReadResult,
  PointSample,
  PointWriteRequest,
  PointWriteResult,
} from '../../../types';

export const acquisitionApi = {
  // ===== 类型化采集适配器 =====
  describeAcquisitionPoints: (payload: DriverPayload) =>
    transport.call<PointDescriptor[]>('describe_acquisition_points', { payload }),

  listAdapterCapabilities: () =>
    transport.call<AdapterCapability[]>('list_adapter_capabilities'),

  discoverAcquisitionEndpoints: (adapterId: string) =>
    transport.call<DiscoveredEndpoint[]>('discover_acquisition_endpoints', { adapterId }),

  validateAdapterConfiguration: (payload: DriverPayload) =>
    transport.call<DriverPayload>('validate_adapter_configuration', { payload }),

  openAcquisitionNode: (nodeId: string) =>
    transport.call<DeviceTreeNodeSnapshot>('open_acquisition_endpoint', { nodeId }),

  closeAcquisitionNode: (nodeId: string) =>
    transport.call<void>('close_acquisition_endpoint', { nodeId }),

  listAcquisitionNodes: () =>
    transport.call<DeviceTreeNodeSnapshot[]>('list_acquisition_endpoints'),

  listDeviceTreeNodes: () =>
    transport.call<DeviceTreeNodeSnapshot[]>('list_device_tree_nodes'),

  listDriverManifests: () =>
    transport.call<DriverManifestProjection[]>('list_driver_manifests'),

  getModelCatalog: () => transport.call<unknown>('get_model_catalog'),
  prepareNodeDocuments: (request: Record<string, unknown>) =>
    transport.call<unknown>('prepare_node_documents', request),
  describeNodeDocuments: (request: Record<string, unknown>) =>
    transport.call<unknown>('describe_node_documents', request),

  readAcquisitionPoints: (nodeId: string, pointIds: string[]) =>
    transport.call<PointReadResult>('read_acquisition_points', { nodeId, pointIds }),

  subscribeAcquisitionPoints: (
    nodeId: string,
    pointIds: string[],
    acquisition: AcquisitionIntent,
  ) => transport.call<EffectiveSubscription>('subscribe_acquisition_points', {
    nodeId,
    intent: { points: pointIds, acquisition },
  }),

  writeAcquisitionPoints: (nodeId: string, request: PointWriteRequest) =>
    transport.call<PointWriteResult>('write_acquisition_points', { nodeId, request }),

  latestAcquisitionSamples: (nodeId: string) =>
    transport.call<PointSample[]>('latest_acquisition_samples', { nodeId }),

  // ===== 设备传输 (nodeId = 图中设备节点 id) =====
};
