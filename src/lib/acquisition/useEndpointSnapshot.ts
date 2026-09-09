import { useEffect, useSyncExternalStore } from 'react';
import type { EndpointSnapshot } from '../../types';
import { api } from '../tauri/tauri';

let snapshots = new Map<string, EndpointSnapshot>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let refreshing: Promise<void> | undefined;

export function refreshEndpointSnapshots(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = api.listAcquisitionEndpoints().then((items) => {
    snapshots = new Map(items.map((item) => [item.id, item]));
    listeners.forEach((listener) => listener());
  }).catch(() => undefined).finally(() => { refreshing = undefined; });
  return refreshing;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(() => { void refreshEndpointSnapshots(); }, 1000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useEndpointSnapshot(id: string): EndpointSnapshot | undefined {
  useEffect(() => { void refreshEndpointSnapshots(); }, [id]);
  return useSyncExternalStore(subscribe, () => snapshots.get(id));
}
