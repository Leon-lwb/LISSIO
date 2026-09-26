// ============ 模型目录 store ============
//
// 后端模型目录的唯一获取入口 (get_model_catalog)。生命周期与连接绑定:
// configure/disconnect 每次变化递增 generation, 旧连接的迟到响应不得写入。
// envelope 校验: contractVersion 不支持 → incompatible (兼容错误页),
// 结构损坏 → error (可重试)。

import { create } from 'zustand';
import type { ModelCatalog } from '../types/generated/ModelCatalog';
import type { ModelDescriptor } from '../types/generated/ModelDescriptor';
import { api } from '../lib/tauri/tauri';

export const MODEL_CATALOG_CONTRACT_VERSION = 1;

export type CatalogStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error'
  | 'incompatible';

export interface ModelCatalogState {
  status: CatalogStatus;
  /** 连接代际 — configure/disconnect 变化时递增, 隔离旧连接响应 */
  generation: number;
  revision: string;
  contractVersion: number;
  byId: Readonly<Record<string, ModelDescriptor>>;
  models: readonly ModelDescriptor[];
  error: string | null;
  load: (generation: number) => Promise<void>;
  invalidate: () => void;
  bumpGeneration: () => number;
}

function isModelCatalog(value: unknown): value is ModelCatalog {
  if (typeof value !== 'object' || value === null) return false;
  const catalog = value as Partial<ModelCatalog>;
  return (
    typeof catalog.contractVersion === 'number' &&
    typeof catalog.revision === 'string' &&
    Array.isArray(catalog.models) &&
    catalog.models.every(
      (model) =>
        typeof model === 'object' &&
        model !== null &&
        typeof (model).id === 'string' &&
        typeof (model).family === 'string',
    )
  );
}

function indexModels(models: readonly ModelDescriptor[]): Record<string, ModelDescriptor> {
  const byId: Record<string, ModelDescriptor> = {};
  for (const model of models) byId[model.id] = model;
  return byId;
}

export const useModelCatalogStore = create<ModelCatalogState>((set, get) => ({
  status: 'idle',
  generation: 0,
  revision: '',
  contractVersion: 0,
  byId: {},
  models: [],
  error: null,

  async load(generation) {
    if (get().status === 'loading') return;
    set({ status: 'loading', error: null });
    try {
      const raw: unknown = await api.getModelCatalog();
      // 迟到响应: 发起时的 generation 已失效则丢弃
      if (generation !== get().generation) return;
      if (!isModelCatalog(raw)) {
        set({ status: 'error', error: '模型目录结构无效' });
        return;
      }
      if (raw.contractVersion !== MODEL_CATALOG_CONTRACT_VERSION) {
        set({ status: 'incompatible', contractVersion: raw.contractVersion });
        return;
      }
      set({
        status: 'ready',
        revision: raw.revision,
        contractVersion: raw.contractVersion,
        byId: indexModels(raw.models),
        models: raw.models,
      });
    } catch (error) {
      if (generation !== get().generation) return;
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  },

  invalidate() {
    set({
      status: 'idle',
      revision: '',
      byId: {},
      models: [],
      error: null,
    });
  },

  bumpGeneration() {
    const generation = get().generation + 1;
    set({ generation });
    get().invalidate();
    return generation;
  },
}));

/** 目录是否就绪且可用 (供创建入口与启动屏障判断)。 */
export function isCatalogReady(): boolean {
  return useModelCatalogStore.getState().status === 'ready';
}

/** 测试辅助 — 清空目录状态。 */
export function resetModelCatalogForTests(): void {
  useModelCatalogStore.setState({
    status: 'idle',
    generation: 0,
    revision: '',
    contractVersion: 0,
    byId: {},
    models: [],
    error: null,
  });
}
