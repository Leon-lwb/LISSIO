import { transport } from '../rpc';
import type { SubscriptionHandle } from '../rpc/types';
import {
  decodeSampleEnvelope,
  type DecodedSampleBatch,
  type PortSampleStatus,
} from './sampleProtocol';

const MAX_PREVIEW_ROWS = 500;

export interface PortSampleSnapshot {
  version: number;
  status: PortSampleStatus;
  rows: { seq: number; ts: number; value: number }[];
  previewSkipped: number;
  retentionEvicted: number;
  ingressDropped: number;
  error: string | null;
}

interface Entry {
  key: string;
  sourceNodeId: string;
  sourceHandle: string;
  subscription: SubscriptionHandle | null;
  listeners: Set<() => void>;
  snapshot: PortSampleSnapshot;
  generation: number;
  startingGeneration: number | null;
  inFlightGeneration: number | null;
  pendingDecode: DecodeJob | null;
  localPreviewSkipped: number;
}

interface DecodeJob {
  buffer: ArrayBuffer;
  generation: number;
  receivedAt: number;
}

const EMPTY_SNAPSHOT: PortSampleSnapshot = Object.freeze({
  version: 0,
  status: 'waiting',
  rows: [],
  previewSkipped: 0,
  retentionEvicted: 0,
  ingressDropped: 0,
  error: null,
});

const entries = new Map<string, Entry>();
// facade 缓存: 同一 key 必须复用同一 store 对象 — useSyncExternalStore 依赖
// subscribe/getSnapshot 引用稳定, 若每次调用都新建 facade, React 会在每次渲染后
// 退订/重订阅, 叠加 start() 同步替换快照, 形成 "Maximum update depth" 死循环。
const stores = new Map<string, PortSampleStore>();
const IDLE_STORE_MS = 1_000;
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

const INVALID_PORT_STORE: PortSampleStore = {
  subscribe: () => () => { return undefined; },
  getSnapshot: () => EMPTY_SNAPSHOT,
  clear: () => { return undefined; },
};
let decoderWorker: Worker | null | undefined;
let nextGeneration = 0;

function topicKey(sourceNodeId: string, sourceHandle: string): string {
  return `${sourceNodeId}\u0000${sourceHandle}`;
}

function getWorker(): Worker | null {
  if (decoderWorker !== undefined) return decoderWorker;
  if (typeof Worker === 'undefined') {
    decoderWorker = null;
    return null;
  }
  decoderWorker = new Worker(
    new URL('./sampleDecode.worker.ts', import.meta.url),
    {
      type: 'module',
    },
  );
  decoderWorker.onmessage = (
    event: MessageEvent<{
      key: string;
      generation: number;
      receivedAt: number;
      batch?: DecodedSampleBatch;
      error?: string;
    }>,
  ) => {
    const entry = entries.get(event.data.key);
    if (!entry) return;
    if (entry.inFlightGeneration !== event.data.generation) return;
    entry.inFlightGeneration = null;
    if (entry.generation === event.data.generation) {
      if (event.data.error) {
        updateEntry(entry, undefined, event.data.error);
      } else if (event.data.batch) {
        updateEntry(
          entry,
          event.data.batch,
          null,
          performance.now() - event.data.receivedAt,
        );
      }
    }
    dispatchPendingDecode(entry);
  };
  return decoderWorker;
}

function updateEntry(
  entry: Entry,
  batch?: DecodedSampleBatch,
  error: string | null = null,
  elapsedMs = 0,
) {
  const start = performance.now();
  if (batch) {
    // 状态事件与数值正交：disconnect/out-of-range 等空批次保留最后有效样本，
    // 避免 UI 把断流误显示为 0。显式 clear/reset 仍会清空历史。
    const rows = batch.rows.length > 0
      ? [...entry.snapshot.rows, ...batch.rows]
      : entry.snapshot.rows;
    entry.snapshot = {
      version: entry.snapshot.version + 1,
      status: batch.status,
      rows:
        rows.length > MAX_PREVIEW_ROWS ? rows.slice(-MAX_PREVIEW_ROWS) : rows,
      previewSkipped: batch.previewSkipped + entry.localPreviewSkipped,
      retentionEvicted: batch.retentionEvicted,
      ingressDropped: batch.ingressDropped,
      error,
    };
  } else {
    entry.snapshot = {
      ...entry.snapshot,
      version: entry.snapshot.version + 1,
      error,
    };
  }
  for (const listener of entry.listeners) listener();
  // 背压反馈: 订阅 id 由出口分配, 但流帧到达时必定已就绪 (见 SubscriptionHandle.id)
  const subscriptionId = entry.subscription?.id;
  if (batch && subscriptionId != null) {
    // 反馈失败不影响渲染 — 后端只把它当节流参考
    void transport
      .call('ack_data', {
        subscriptionId,
        sequence: batch.sequence,
        bufferedBytes: batch.byteLength,
        renderMs: elapsedMs + performance.now() - start,
      })
      .catch(() => undefined);
  }
}

function normalizeBuffer(value: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  );
}

function dispatchPendingDecode(entry: Entry) {
  if (entry.inFlightGeneration !== null) return;
  const job = entry.pendingDecode;
  entry.pendingDecode = null;
  if (job?.generation !== entry.generation) return;
  const worker = getWorker();
  if (!worker) {
    try {
      updateEntry(
        entry,
        decodeSampleEnvelope(job.buffer),
        null,
        performance.now() - job.receivedAt,
      );
    } catch (error) {
      updateEntry(
        entry,
        undefined,
        error instanceof Error ? error.message : String(error),
      );
    }
    return;
  }
  entry.inFlightGeneration = job.generation;
  worker.postMessage(
    {
      key: entry.key,
      generation: job.generation,
      receivedAt: job.receivedAt,
      buffer: job.buffer,
    },
    [job.buffer],
  );
}

function enqueueDecode(entry: Entry, job: DecodeJob) {
  if (job.generation !== entry.generation) return;
  if (entry.pendingDecode) entry.localPreviewSkipped++;
  entry.pendingDecode = job;
  dispatchPendingDecode(entry);
}

function start(entry: Entry) {
  if (entry.subscription || entry.startingGeneration !== null) return;
  const generation = ++nextGeneration;
  entry.generation = generation;
  entry.startingGeneration = generation;
  entry.localPreviewSkipped = 0;
  entry.snapshot = {
    ...EMPTY_SNAPSHOT,
    version: entry.snapshot.version + 1,
  };
  const subscription = transport.subscribe<ArrayBuffer>(
    {
      kind: 'port_samples',
      source_node_id: entry.sourceNodeId,
      source_handle: entry.sourceHandle,
    },
    (message) => {
      if (entry.generation !== generation || entry.subscription !== subscription) return;
      const buffer = normalizeBuffer(message);
      enqueueDecode(entry, { buffer, generation, receivedAt: performance.now() });
    },
    {
      intervalMs: 17,
      maxItems: MAX_PREVIEW_ROWS,
      onError: (error) => {
        if (entry.generation === generation) {
          updateEntry(entry, undefined, String(error));
        }
      },
    },
  );
  entry.subscription = subscription;
  // 建立是异步的: 期间可能被 stop() 取消, 也可能有新的监听者挂上来。
  // 取消由出口负责注销, 这里只需在建立结束后收回守卫并按需重订。
  void subscription.settled.then(() => {
    if (entry.startingGeneration === generation) {
      entry.startingGeneration = null;
    }
    if (entry.listeners.size > 0 && !entry.subscription) start(entry);
  });
}

function stop(entry: Entry) {
  entry.generation = ++nextGeneration;
  entry.startingGeneration = null;
  entry.pendingDecode = null;
  const subscription = entry.subscription;
  entry.subscription = null;
  subscription?.cancel();
}

function cancelIdleCleanup(key: string) {
  const timer = idleTimers.get(key);
  if (timer === undefined) return;
  clearTimeout(timer);
  idleTimers.delete(key);
}

function scheduleIdleCleanup(key: string, entry: Entry, store: PortSampleStore) {
  cancelIdleCleanup(key);
  idleTimers.set(key, setTimeout(() => {
    idleTimers.delete(key);
    if (entry.listeners.size > 0 || stores.get(key) !== store) return;
    entries.delete(key);
    stores.delete(key);
  }, IDLE_STORE_MS));
}

export interface PortSampleStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PortSampleSnapshot;
  clear: () => void;
}

export function getPortSampleStore(
  sourceNodeId: string | undefined,
  sourceHandle: string | undefined,
): PortSampleStore {
  if (!sourceNodeId || !sourceHandle) {
    return INVALID_PORT_STORE;
  }
  const key = topicKey(sourceNodeId, sourceHandle);
  const store = stores.get(key);
  if (store) return store;
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      key,
      sourceNodeId,
      sourceHandle,
      subscription: null,
      listeners: new Set(),
      snapshot: EMPTY_SNAPSHOT,
      generation: 0,
      startingGeneration: null,
      inFlightGeneration: null,
      pendingDecode: null,
      localPreviewSkipped: 0,
    };
    entries.set(key, entry);
  }
  const target = entry;
  const facade: PortSampleStore = {
    subscribe(listener) {
      const current = stores.get(key);
      if (current && current !== facade) return current.subscribe(listener);
      if (!current) {
        stores.set(key, facade);
        entries.set(key, target);
      }
      cancelIdleCleanup(key);
      target.listeners.add(listener);
      if (target.listeners.size === 1) start(target);
      return () => {
        target.listeners.delete(listener);
        if (target.listeners.size === 0) {
          stop(target);
          scheduleIdleCleanup(key, target, facade);
        }
      };
    },
    getSnapshot: () => {
      const current = stores.get(key);
      return current && current !== facade ? current.getSnapshot() : target.snapshot;
    },
    clear() {
      const current = stores.get(key);
      if (current && current !== facade) {
        current.clear();
        return;
      }
      target.snapshot = {
        ...EMPTY_SNAPSHOT,
        version: target.snapshot.version + 1,
      };
      for (const listener of target.listeners) listener();
    },
  };
  stores.set(key, facade);
  scheduleIdleCleanup(key, target, facade);
  return facade;
}

export function resetPortSampleStoresForSource(sourceNodeId: string): void {
  for (const entry of entries.values()) {
    if (entry.sourceNodeId !== sourceNodeId) continue;
    const shouldRestart = entry.listeners.size > 0;
    stop(entry);
    entry.snapshot = {
      ...EMPTY_SNAPSHOT,
      version: entry.snapshot.version + 1,
    };
    entry.localPreviewSkipped = 0;
    entry.pendingDecode = null;
    for (const listener of entry.listeners) listener();
    if (shouldRestart) start(entry);
  }
}
