// ============ 节点描述缓存 (describe_node_documents 消费层) ============
//
// 图变化 → 防抖批量描述 → 按节点缓存 NodeDescription。requestRevision 丢弃
// 迟到响应; pending 期间保留上一份描述 (端口不闪空、边不悬空); absent /
// pending / ready(-empty) / incomplete / unsupported 由条目状态与描述内容区分。
//
// 订阅自 App 挂载后启动 (startDescribeSync); 连接代际变化时由接线方调用
// invalidateDescriptions() 清空缓存。

import { create } from 'zustand';
import type { NodeDescription } from '../../types/generated/NodeDescription';
import type { NodePortDomain } from '../../types/generated/NodePortDomain';
import type { DomainType } from '../../types';
import { api } from '../tauri/tauri';
import { nodeDocument, type NodeDocument } from '../nodes/document';
import { useAppStore } from '../../store/appStore';

export type DescribeStatus = 'absent' | 'pending' | 'ready' | 'incomplete' | 'unsupported';

export interface DescribeEntry {
  status: DescribeStatus;
  /** 上一份权威描述 — pending 失败时保留旧值供端口渲染 (不闪空)。 */
  description: NodeDescription | null;
  failed: boolean;
}

const ABSENT: DescribeEntry = { status: 'absent', description: null, failed: false };

interface DescribeState {
  entries: Readonly<Record<string, DescribeEntry>>;
  setPending: (ids: string[]) => void;
  /** 合并式采纳 — 只新增/更新, 不动其他节点条目。 */
  adopt: (descriptions: NodeDescription[]) => void;
  /** 全图描述收敛后裁剪已删除节点的条目。 */
  pruneExcept: (ids: string[]) => void;
  markFailed: () => void;
  clear: () => void;
}

export const useDescribeStore = create<DescribeState>((set) => ({
  entries: {},

  setPending: (ids) =>
    set((s) => {
      const entries = { ...s.entries };
      for (const id of ids) {
        const previous = entries[id];
        entries[id] = previous
          ? { ...previous, status: 'pending', failed: false }
          : { status: 'pending', description: null, failed: false };
      }
      return { entries };
    }),

  adopt: (descriptions) =>
    set((s) => {
      if (descriptions.length === 0) return s;
      const entries = { ...s.entries };
      for (const description of descriptions) {
        entries[description.nodeId] = {
          status: description.status === 'ready' ? 'ready' : description.status,
          description,
          failed: false,
        };
      }
      return { entries };
    }),

  pruneExcept: (ids) =>
    set((s) => {
      const keep = new Set(ids);
      const filtered = Object.fromEntries(
        Object.entries(s.entries).filter(([id]) => keep.has(id)),
      );
      if (Object.keys(filtered).length === Object.keys(s.entries).length) return s;
      return { entries: filtered };
    }),

  markFailed: () =>
    set((s) => {
      const entries: Record<string, DescribeEntry> = {};
      for (const [id, entry] of Object.entries(s.entries)) {
        entries[id] = { ...entry, failed: true, status: entry.description ? entry.status : 'absent' };
      }
      return { entries };
    }),

  clear: () => set({ entries: {} }),
}));

// ---- 描述域 → 前端 DomainType 词表映射 (NodePortDomain wire 与 graph:derived 同源) ----

export function describeDomainToUi(domain: NodePortDomain): DomainType {
  switch (domain) {
    case 'Points': return 'points';
    case 'F32': return 'time';
    case 'Bytes': return 'bytes';
    case 'String': return 'string';
    case 'Spectrum': return 'freq';
  }
}

/** 当前节点描述条目 (渲染层经由 store 订阅)。 */
export function useDescribeEntry(nodeId: string): DescribeEntry {
  return useDescribeStore((s) => s.entries[nodeId] ?? ABSENT);
}

/** 非订阅读取 (连线校验等一次性判断用)。 */
export function getDescribeEntry(nodeId: string): DescribeEntry {
  return useDescribeStore.getState().entries[nodeId] ?? ABSENT;
}

// ---- 批量防抖调度 ----

const FLUSH_DEBOUNCE_MS = 60;

let requestRevision = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let dirty = false;
let unsubscribe: (() => void) | null = null;

function documentsOfStore(): { documents: NodeDocument[]; edges: { source: string; sourceHandle: string | null; target: string; targetHandle: string | null }[] } {
  const state = useAppStore.getState();
  const ids = new Set(state.rfNodes.map((n) => n.id));
  return {
    documents: state.rfNodes.map(nodeDocument),
    edges: state.rfEdges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        source: e.source,
        sourceHandle: e.sourceHandle ?? null,
        target: e.target,
        targetHandle: e.targetHandle ?? null,
      })),
  };
}

async function flush(): Promise<void> {
  flushTimer = null;
  if (!dirty || inFlight) return;
  dirty = false;
  const { documents, edges } = documentsOfStore();
  const ids = documents.map((d) => d.id);
  // pending 标记保留上一份描述; 不在 ids 里的节点 (已删除) 由 adopt 清除
  useDescribeStore.getState().setPending(ids);
  requestRevision += 1;
  const revision = requestRevision;
  inFlight = true;
  try {
    const response = (await api.describeNodeDocuments({
      documents,
      edges,
      requestRevision: revision,
    })) as { requestRevision: number; nodes: NodeDescription[] } | undefined;
    if (revision !== requestRevision) return;
    if (!response || !Array.isArray(response.nodes)) {
      useDescribeStore.getState().markFailed();
      return;
    }
    useDescribeStore.getState().adopt(response.nodes);
    // 全图收敛: 裁剪已删除节点的条目 (响应携带当次全量节点集)
    useDescribeStore.getState().pruneExcept(response.nodes.map((n) => n.nodeId));
  } catch {
    // 描述失败不回滚端口 — 保留上一份描述, 仅标记, 下次变化重试
    if (revision === requestRevision) useDescribeStore.getState().markFailed();
  } finally {
    inFlight = false;
    if (dirty) void flush();
  }
}

function scheduleFlush(immediate = false): void {
  dirty = true;
  if (flushTimer !== null) return;
  if (immediate) { void flush(); return; }
  flushTimer = setTimeout(() => { void flush(); }, FLUSH_DEBOUNCE_MS);
}

/** 订阅图变化并自动批量描述 — App 挂载 (目录就绪后) 调用一次。 */
export function startDescribeSync(): void {
  if (unsubscribe) return;
  let prevNodes: unknown = null;
  let prevEdges: unknown = null;
  unsubscribe = useAppStore.subscribe((s) => {
    if (s.rfNodes !== prevNodes || s.rfEdges !== prevEdges) {
      prevNodes = s.rfNodes;
      prevEdges = s.rfEdges;
      scheduleFlush();
    }
  });
  scheduleFlush(true);
}

export function stopDescribeSync(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  inFlight = false;
  dirty = false;
}

/** 连接代际变化 / 测试重置 — 清空缓存 (旧连接描述不得跨代复用)。 */
export function invalidateDescriptions(): void {
  requestRevision += 1;
  useDescribeStore.getState().clear();
}

export function resetDescribeForTests(): void {
  stopDescribeSync();
  invalidateDescriptions();
}
