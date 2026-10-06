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
    try {
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
    } catch (error) {
      // 同步抛错 (卡片形状意外、适配器字段缺失) 也要收尾: 否则 `setPending(true)`
      // 之后再没人把它放回 false, 发现按钮会一直转圈且永远不报错。
      if (request === generation.current) setErrors([formatError(error)]);
    } finally {
      // 收尾同样只在"本次仍是最新请求"时执行, 避免被取代的旧请求把新请求的
      // 忙碌状态提前清掉。`setPending` 对同值 setState 是 no-op, 重复调用无副作用。
      if (request === generation.current) setPending(false);
    }
  }, [cards]);
  const cancel = useCallback(() => { generation.current++; }, []);
  useEffect(() => { void refresh(); return cancel; }, [refresh, cancel]);
  return { discoveries, pending, errors, refresh };
}
