// ============ 模型目录 store ============
//
// 后端模型目录的唯一获取入口 (get_model_catalog)。生命周期与连接绑定:
// configure/disconnect 每次变化递增 generation, 旧连接的迟到响应不得写入。
// envelope 校验: contractVersion 不支持 → incompatible (incompatible 错误页),
// 结构损坏 → error (可重试)。

import { create } from 'zustand';
import type { ModelCatalog } from '../types/generated/ModelCatalog';
import type { ModelDescriptor } from '../types/generated/ModelDescriptor';
import type { PanelDescriptor } from '../types/generated/PanelDescriptor';
import { api } from '../lib/tauri/tauri';

// 与后端 data_model::model_descriptor::MODEL_CATALOG_CONTRACT_VERSION 同步。
// v2: ModelCatalog 增加 panels (数据面板契约) — 与 models 同一次下发、同一版本号。
export const MODEL_CATALOG_CONTRACT_VERSION = 2;

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
  /**
   * 后端下发的数据面板契约 — 与 models 同一次下发。
   * `undefined` = 该段**未下发** (老后端 / 尚未加载), 与「下发了一个空段」不同:
   * 前者无从比对, 后者才是「后端没有任何面板」。
   */
  panels: readonly PanelDescriptor[] | undefined;
  /** 面板身份 → 描述符 (前端对照后端契约用) */
  panelsByKind: Readonly<Record<string, PanelDescriptor>>;
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
    ) &&
    // 面板是版本 2 起新增的可选段 — 缺省容忍 (老后端 / 精简目录), 但形状不对要拒
    (catalog.panels === undefined ||
      (Array.isArray(catalog.panels) &&
        catalog.panels.every(
          (panel) =>
            typeof panel === 'object' &&
            panel !== null &&
            typeof (panel).id === 'string' &&
            typeof (panel).kind === 'string' &&
            typeof (panel).tabType === 'string',
        )))
  );
}

function indexModels(models: readonly ModelDescriptor[]): Record<string, ModelDescriptor> {
  const byId: Record<string, ModelDescriptor> = {};
  for (const model of models) byId[model.id] = model;
  return byId;
}

function indexPanels(
  panels: readonly PanelDescriptor[] | undefined
): Record<string, PanelDescriptor> {
  const byKind: Record<string, PanelDescriptor> = {};
  for (const panel of panels ?? []) byKind[panel.kind] = panel;
  return byKind;
}

/// 「空目录」状态 — 初始状态、invalidate 与测试重置共用一份, 避免三处漂移。
/// 不含 generation / contractVersion: 前者由连接生命周期推进, 后者由 load 写入。
const EMPTY_CATALOG_STATE = {
  status: 'idle',
  revision: '',
  byId: {},
  models: [],
  panels: undefined,
  panelsByKind: {},
  error: null,
} satisfies Partial<ModelCatalogState>;

export const useModelCatalogStore = create<ModelCatalogState>((set, get) => ({
  ...EMPTY_CATALOG_STATE,
  generation: 0,
  contractVersion: 0,

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
      const panels = raw.panels;
      set({
        status: 'ready',
        revision: raw.revision,
        contractVersion: raw.contractVersion,
        byId: indexModels(raw.models),
        models: raw.models,
        panels,
        panelsByKind: indexPanels(panels),
      });
    } catch (error) {
      if (generation !== get().generation) return;
      set({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  },

  invalidate() {
    set(EMPTY_CATALOG_STATE);
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
    ...EMPTY_CATALOG_STATE,
    generation: 0,
    contractVersion: 0,
  });
}
