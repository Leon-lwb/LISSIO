import { useMemo, useSyncExternalStore } from 'react';
import type { Edge } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/appStore';
import {
  getPortSampleStore,
  type PortSampleSnapshot,
  type PortSampleStore,
} from '../data/dataClient';
import {
  numericPortRef,
  type NumericPortRef,
  type NumericPortState,
} from '../data/numericTypes';

const EMPTY_SNAPSHOT: PortSampleSnapshot = Object.freeze({
  version: 0,
  status: 'waiting',
  rows: [],
  previewSkipped: 0,
  retentionEvicted: 0,
  ingressDropped: 0,
  error: null,
});

const EMPTY_STORE: PortSampleStore = {
  subscribe: () => () => { return undefined; },
  getSnapshot: () => EMPTY_SNAPSHOT,
  clear: () => { return undefined; },
};

interface ResolvedNumericPort {
  ref: NumericPortRef | null;
  connected: boolean;
}

/** 纯函数端口解析器；示波器和普通显示节点共享同一 edge 语义。 */
export function resolveNumericInputRef(
  edges: readonly Edge[],
  widgetId: string,
  inputHandle: string,
): ResolvedNumericPort {
  const edge = edges.find(
    (candidate) =>
      candidate.target === widgetId && candidate.targetHandle === inputHandle,
  );
  if (edge) {
    return {
      ref: numericPortRef(edge.source, edge.sourceHandle ?? 'value'),
      connected: true,
    };
  }
  return { ref: null, connected: false };
}

function stateFromSnapshot(
  resolved: ResolvedNumericPort,
  snapshot: PortSampleSnapshot,
): NumericPortState {
  return {
    source: resolved.ref,
    connected: resolved.connected,
    status: snapshot.status,
    latest: snapshot.rows[snapshot.rows.length - 1] ?? null,
    history: snapshot.rows,
    previewSkipped: snapshot.previewSkipped,
    retentionEvicted: snapshot.retentionEvicted,
    ingressDropped: snapshot.ingressDropped,
    error: snapshot.error,
  };
}

function storeFor(ref: NumericPortRef | null): PortSampleStore {
  return ref ? getPortSampleStore(ref.nodeId, ref.handle) : EMPTY_STORE;
}

function useResolvedPort(resolved: ResolvedNumericPort): NumericPortState {
  // storeFor 对相同 key 返回缓存的 facade (见 dataClient.getPortSampleStore),
  // 保证 subscribe/getSnapshot 引用跨渲染稳定 — 否则 useSyncExternalStore 会
  // 每次渲染退订重订阅, 触发 "Maximum update depth exceeded"。
  const store = storeFor(resolved.ref);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return stateFromSnapshot(resolved, snapshot);
}

export function useNumericPort(ref: NumericPortRef | null): NumericPortState {
  const resolved: ResolvedNumericPort = {
    ref,
    connected: ref !== null,
  };
  return useResolvedPort(resolved);
}

export function useNumericInput(
  widgetId: string,
  inputHandle = 'value',
): NumericPortState {
  // 仅订阅本输入端口；无关连线变化不应促使显示控件重渲染。
  const edges = useAppStore(
    useShallow((state) =>
      (state.rfEdges ?? []).filter(
        (edge) => edge.target === widgetId && edge.targetHandle === inputHandle,
      ),
    ),
  );
  const resolved = useMemo(
    () => resolveNumericInputRef(edges, widgetId, inputHandle),
    [edges, widgetId, inputHandle],
  );
  return useResolvedPort(resolved);
}

export function useNumericOutput(nodeId: string, outputHandle: string): NumericPortState {
  const resolved = useMemo<ResolvedNumericPort>(
    () => ({
      ref: numericPortRef(nodeId, outputHandle),
      connected: true,
    }),
    [nodeId, outputHandle],
  );
  return useResolvedPort(resolved);
}

interface AggregateSnapshot {
  readonly snapshots: readonly PortSampleSnapshot[];
}

function aggregateStore(refs: readonly (NumericPortRef | null)[]) {
  const stores = refs.map(storeFor);
  let current: AggregateSnapshot = {
    snapshots: stores.map((store) => store.getSnapshot()),
  };
  return {
    // 箭头函数属性 (非方法简写): 解构使用时避免 unbound-method 语义,
    // 且保证每个 aggregate 实例的 subscribe/getSnapshot 引用唯一且稳定。
    subscribe: (listener: () => void) => {
      const unsubs = stores.map((store, index) =>
        store.subscribe(() => {
          const next = store.getSnapshot();
          if (current.snapshots[index] === next) return;
          const snapshots = [...current.snapshots];
          snapshots[index] = next;
          current = { snapshots };
          listener();
        }),
      );
      return () => unsubs.forEach((unsubscribe) => unsubscribe());
    },
    getSnapshot: () => current,
  };
}

/** 动态多端口 Hook：内部组合 external stores，不在循环中调用 React Hook。 */
export function useNumericInputs<const T extends readonly string[]>(
  widgetId: string,
  inputHandles: T,
): Readonly<Record<T[number], NumericPortState>> {
  // 窄订阅：仅本 widget 输入端口的边。
  // useShallow 令替换无关边数组时保持引用稳定。
  const edges = useAppStore(
    useShallow((state) =>
      (state.rfEdges ?? []).filter(
        (edge) =>
          edge.target === widgetId && inputHandles.includes(edge.targetHandle ?? ''),
      ),
    ),
  );
  const resolved = inputHandles.map((handle) =>
    resolveNumericInputRef(edges, widgetId, handle)
  );
  const refsKey = resolved
    .map(({ ref }) => (ref ? `${ref.nodeId}\u0001${ref.handle}` : ''))
    .join('\u0000');
  const aggregate = useMemo(() => {
    const refs = refsKey === ''
      ? []
      : refsKey.split('\u0000').map((key) => {
          if (key === '') return null;
          const separator = key.indexOf('\u0001');
          return numericPortRef(key.slice(0, separator), key.slice(separator + 1));
        });
    return aggregateStore(refs);
  }, [refsKey]);
  // subscribe/getSnapshot 是 aggregateStore 实例上的方法 (每个 aggregate 只创建一次),
  // 解构后引用稳定 — 内联箭头函数会让 useSyncExternalStore 每次渲染重订阅,
  // 触发 "Maximum update depth exceeded"。
  const { subscribe, getSnapshot } = aggregate;
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const result: Record<string, NumericPortState> = {};
  for (let index = 0; index < inputHandles.length; index++) {
    result[inputHandles[index]] = stateFromSnapshot(
      resolved[index],
      snapshot.snapshots[index] ?? EMPTY_SNAPSHOT,
    );
  }
  return result as Readonly<Record<T[number], NumericPortState>>;
}

export const useNumericHistory = useNumericInputs;
