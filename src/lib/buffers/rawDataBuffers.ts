import type { RawDataBuffer } from './dataBuffer';
import type { RawDataBatch } from '../../types';
import {
  subscribeRawData,
  subscribeRawDataFiltered,
  subscribeRawDataNode,
  subscribeRawDataNodeFiltered,
  type RawDataFilterOptions,
} from './rawDataSubscription';
import {
  createRawDataPreviewBuffer,
  trackRawDataPreviewBuffer,
} from './rawDataPreviewRegistry';

interface RawDataEntry {
  buffer: RawDataBuffer;
  refs: number;
  cancel: () => void;
  untrack: () => void;
}

const SUBSCRIBE_OPTIONS = { intervalMs: 100, maxBytes: 65536 } as const;

/// 按 id + 过滤条件注册的原始数据 buffer 注册表 (引用计数)。
/// 多个 RawData 视图查看同一来源时共享一条后端订阅,
/// 最后一个引用释放时取消订阅并移除注册。
function createRawDataRegistry(
  subscribe: (id: string, buffer: RawDataBuffer, filter?: RawDataFilterOptions) => () => void,
) {
  const registry = new Map<string, RawDataEntry>();

  function registryKey(id: string, filter?: RawDataFilterOptions): string {
    return `${id}\u0000${filter?.directionFilter ?? 'all'}\u0000${filter?.searchTerm ?? ''}`;
  }

  return {
    /// 获取指定来源的原始数据 buffer (引用 +1; 不存在时创建并启动后端订阅)
    acquire(id: string, filter?: RawDataFilterOptions): RawDataBuffer {
      const key = registryKey(id, filter);
      const existing = registry.get(key);
      if (existing) {
        existing.refs++;
        return existing.buffer;
      }
      const buffer = createRawDataPreviewBuffer();
      const untrack = trackRawDataPreviewBuffer(buffer);
      const cancel = subscribe(id, buffer, filter);
      registry.set(key, { buffer, refs: 1, cancel, untrack });
      return buffer;
    },

    /// 释放指定来源的原始数据 buffer (引用 -1; 归零时取消订阅并移除注册)
    release(id: string, filter?: RawDataFilterOptions): void {
      const key = registryKey(id, filter);
      const entry = registry.get(key);
      if (!entry) return;
      entry.refs--;
      if (entry.refs <= 0) {
        entry.cancel();
        entry.untrack();
        registry.delete(key);
      }
    },

    /// 清空指定 id 名下的全部 buffer (按注册 key 前缀匹配)
    clearAll(id: string): void {
      const prefix = `${id}\u0000`;
      for (const [key, entry] of registry) {
        if (key.startsWith(prefix)) entry.buffer.clear();
      }
    },
  };
}

/// FrameDecoder 节点旁路来源 (subscribeRawDataNode*)
const nodeRegistry = createRawDataRegistry((id, buffer, filter) => {
  const handler = (batch: RawDataBatch) => buffer.pushBatch(batch);
  return (filter
    ? subscribeRawDataNodeFiltered(id, filter, handler, SUBSCRIBE_OPTIONS)
    : subscribeRawDataNode(id, handler, SUBSCRIBE_OPTIONS)
  ).cancel;
});

/// Transport rx 直连来源 (subscribeRawData*)
const transportRegistry = createRawDataRegistry((id, buffer, filter) => {
  const handler = (batch: RawDataBatch) => buffer.pushBatch(batch);
  return (filter
    ? subscribeRawDataFiltered(id, filter, handler, SUBSCRIBE_OPTIONS)
    : subscribeRawData(id, handler, SUBSCRIBE_OPTIONS)
  ).cancel;
});/// 获取指定 FrameDecoder 节点的原始数据 buffer (引用 +1)
export function acquireRawDataNode(
  nodeId: string,
  filter?: RawDataFilterOptions,
): RawDataBuffer {
  return nodeRegistry.acquire(nodeId, filter);
}

/// 释放指定 FrameDecoder 节点的原始数据 buffer (引用 -1)
export function releaseRawDataNode(nodeId: string, filter?: RawDataFilterOptions): void {
  nodeRegistry.release(nodeId, filter);
}

/// 获取指定字节设备节点的原始数据 buffer (引用 +1；rx/tx 均入该收集器)
export function acquireRawDataTransport(
  transportId: string,
  filter?: RawDataFilterOptions,
): RawDataBuffer {
  return transportRegistry.acquire(transportId, filter);
}

/// 释放指定字节设备节点的原始数据 buffer (引用 -1)
export function releaseRawDataTransport(transportId: string, filter?: RawDataFilterOptions): void {
  transportRegistry.release(transportId, filter);
}

/// 清空指定 Transport 名下的全部原始数据 buffer (连接/断开时调用)
export function clearRawDataTransportBuffers(transportId: string): void {
  transportRegistry.clearAll(transportId);
}
