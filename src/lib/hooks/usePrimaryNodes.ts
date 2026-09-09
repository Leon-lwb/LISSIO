import { useAppStore } from '../../store/appStore';
import type { ProtocolConfig, EndpointSpec } from '../../types';
import type { ProtocolNodeData } from '../../store/appStoreHelpers';
import type { AcquisitionNodeData } from '../acquisition/acquisitionNodes';

export function usePrimaryProtocolConfig(): ProtocolConfig | null {
  return useAppStore(state => {
    const node = state.rfNodes.find(candidate =>
      candidate.type === 'protocol' && candidate.data.tabId === state.activeControlTabId);
    return node ? (node.data as ProtocolNodeData).config : null;
  });
}

export function usePrimaryDeviceSpec(): EndpointSpec | null {
  return useAppStore(state => {
    const node = state.rfNodes.find(candidate =>
      candidate.type === 'acquisition' && candidate.data.tabId === state.activeControlTabId);
    return node ? (node.data as AcquisitionNodeData).spec : null;
  });
}

export function usePrimaryCanTransportNodeId(): string | null {
  return useAppStore(state => {
    const devices = state.rfNodes.filter(candidate =>
      candidate.type === 'acquisition' && candidate.data.tabId === state.activeControlTabId);
    return (devices.find(candidate => {
      const id = (candidate.data as AcquisitionNodeData).spec.driver.driverId;
      return id === 'slcan' || id === 'candle-light';
    }) ?? devices[0])?.id ?? null;
  });
}
