import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeviceCardModel } from '../../lib/acquisition/deviceCardModel';
import type { DiscoveredEndpoint } from '../../types';
import { api } from '../../lib/tauri/tauri';
import { formatError } from '../../lib/tauri/notifications';

export function useDeviceDiscovery(cards: DeviceCardModel[]) {
  const [discoveries, setDiscoveries] = useState<Record<string, DiscoveredEndpoint[]>>({});
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setPending(true);
    setErrors([]);
    const adapters = [...new Map(cards.filter((card) => card.adapter.operations.discover && card.endpoint.status.state !== 'unavailable')
      .map((card) => [card.adapter.adapterId, card.adapter])).values()];
    const results = await Promise.allSettled(adapters.map((adapter) => api.discoverAcquisitionEndpoints(adapter.adapterId)));
    if (request !== generation.current) return;
    const next: Record<string, DiscoveredEndpoint[]> = {};
    const failures: string[] = [];
    results.forEach((result, index) => {
      const adapter = adapters[index];
      if (result.status === 'fulfilled') next[adapter.adapterId] = result.value;
      else failures.push(`${adapter.displayName}: ${formatError(result.reason)}`);
    });
    setDiscoveries(next);
    setErrors(failures);
    setPending(false);
  }, [cards]);
  const cancel = useCallback(() => { generation.current++; }, []);
  useEffect(() => { void refresh(); return cancel; }, [refresh, cancel]);
  return { discoveries, pending, errors, refresh };
}
