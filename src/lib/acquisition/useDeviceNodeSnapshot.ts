import { useEffect, useSyncExternalStore } from 'react';
import type { DeviceTreeNodeSnapshot } from '../../types';
import { api } from '../tauri/tauri';

let snapshots = new Map<string, DeviceTreeNodeSnapshot>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let refreshing: Promise<void> | undefined;

export function refreshDeviceNodeSnapshots(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = api.listDeviceTreeNodes().then((items) => {
    snapshots = new Map(items.map((item) => [item.nodeId, item]));
    listeners.forEach((listener) => listener());
  }).catch(() => undefined).finally(() => { refreshing = undefined; });
  return refreshing;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(() => { void refreshDeviceNodeSnapshots(); }, 1000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useDeviceNodeSnapshot(id: string): DeviceTreeNodeSnapshot | undefined {
  useEffect(() => { void refreshDeviceNodeSnapshots(); }, [id]);
  return useSyncExternalStore(subscribe, () => snapshots.get(id));
}
