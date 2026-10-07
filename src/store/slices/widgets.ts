import type { Node } from '@xyflow/react';
import type { WidgetConfig } from '../../types';
import type { AppSlice } from './types';
import { widgetInputValue } from '../../lib/utils/widgetValue';
import { widgetToTab } from '../../lib/utils/widgetTab';
import { withHistoryOp, widgetKindLabelKey } from '../historyStore';
import type { HistoryOperation, HistoryTarget } from '../historyStore';
import type { AppStore } from '../appStore';
import { selectWidgets } from '../appStoreHelpers';
import { DEFAULT_CUSTOM_CODE } from '../../lib/widgets/customTemplate';
import { createNodeFromCatalog, CatalogError } from '../../lib/models/createFromCatalog';

/** 控件类操作的目标语义 (行首徽章按画布同款分类色渲染) */
const widgetTarget = (kind: WidgetConfig['kind']): HistoryTarget => ({
  kind: 'node',
  node: { kind: 'widget', widgetKind: kind },
});

/// 画布节点的归属目标 — 撤销徽章按节点类型取语义
function canvasTarget(node: Node): HistoryTarget {
  if (node.type === 'widget') {
    return widgetTarget((node.data.widget as WidgetConfig | undefined)?.kind ?? 'Label');
  }
  if (node.type === 'protocol') return { kind: 'node', node: { kind: 'protocol' } };
  if (node.type === 'acquisition') return { kind: 'node', node: { kind: 'transport' } };
  return { kind: 'nodes' };
}

/// 按批次内容派生撤销操作语义 (与旧入口的 opKey 一致)
function canvasOp(nodes: Node[]): HistoryOperation {
  const single = nodes.length === 1 ? nodes[0] : null;
  if (single?.type === 'acquisition') {
    return {
      opKey: 'opAddTransportNode',
      detailText: (single.data.label as string | undefined) ?? undefined,
      target: canvasTarget(single),
    };
  }
  if (single?.type === 'protocol') return { opKey: 'opAddProtocolNode', target: canvasTarget(single) };
  const widgets = nodes.filter((n) => n.type === 'widget');
  const firstWidget = widgets[0]?.data.widget as WidgetConfig | undefined;
  if (nodes.length === 1 && widgets.length === 1 && firstWidget) {
    return {
      opKey: 'opAddWidget',
      detailKey: widgetKindLabelKey(firstWidget.kind) ?? undefined,
      target: widgetTarget(firstWidget.kind),
    };
  }
  return { opKey: 'opAddWidget', target: canvasTarget(nodes[0]) };
}

/// 控件配置归一化入口已下沉后端 (prepare_node_documents / 图提交编译) —
/// 本地只保留 store 写入语义: 数据窗口派生、输入初值、图同步。

export interface WidgetSlice {
  inputPreviewValues: Record<string, number>;
  customEditorState: { open: boolean; widgetId: string | null };
  openCustomEditor: (widgetId?: string) => void;
  closeCustomEditor: () => void;
  /** 插入后端 prepare 产出的画布节点 (目录创建服务的唯一写入路径)。 */
  addCanvasNodes: (nodes: Node[]) => void;
  removeWidget: (id: string) => void;
  updateWidget: (id: string, widget: WidgetConfig) => void;
  previewInputValue: (id: string, value: number) => void;
  commitInputValue: (id: string, value: number) => void;
}

export const createWidgetSlice: AppSlice<WidgetSlice> = (set, get) => {
  return {
    inputPreviewValues: {},
    customEditorState: { open: false, widgetId: null },

    openCustomEditor: (widgetId) => {
      if (widgetId) {
        set({ customEditorState: { open: true, widgetId } });
        return;
      }
      // 新建 Custom: 后端 prepare 产出文档 (编辑器默认代码是 UI 语义, 走 configPatch)
      void (async () => {
        try {
          const node = await createNodeFromCatalog({
            modelId: 'widget:Custom',
            position: { x: 280, y: 80 + Math.random() * 100 },
            configPatch: { code: DEFAULT_CUSTOM_CODE },
          });
          set({ customEditorState: { open: true, widgetId: node.id } });
        } catch (error) {
          if (!(error instanceof CatalogError)) throw error;
        }
      })();
    },

    closeCustomEditor: () => set({ customEditorState: { open: false, widgetId: null } }),

    addCanvasNodes: (nodes) => {
      if (nodes.length === 0) return;
      const widgets = nodes.filter((n) => n.type === 'widget');
      withHistoryOp(canvasOp(nodes), () => {
        set((s) => {
          const newState: Partial<AppStore> = {
            rfNodes: [...s.rfNodes, ...nodes],
          };
          // 有窗口的控件: 自动创建数据窗口 Tab (关闭窗口不会删除节点, 可双击节点重开)
          const tabs = widgets
            .map((n) => widgetToTab(n.data.widget as WidgetConfig))
            .filter((tab): tab is NonNullable<typeof tab> => tab !== null);
          if (tabs.length > 0) {
            newState.dataTabs = [...s.dataTabs, ...tabs];
            newState.activeDataTabId = tabs[tabs.length - 1].id;
          }
          return newState;
        });
        for (const node of widgets) {
          const widget = node.data.widget as WidgetConfig;
          const inputValue = widgetInputValue(widget);
          if (inputValue !== null) get().setInputValue(widget.params.id, inputValue);
        }
        const tabIds = new Set(nodes.map((n) => n.data.tabId as string).filter(Boolean));
        tabIds.forEach((tabId) => { void get().syncTabGraph(tabId); });
      });
    },

    removeWidget: (id) => {
      const widget = selectWidgets(get()).find((w: WidgetConfig) => w.params.id === id);
      const affectedTabs = new Set<string>();
      const node = get().rfNodes.find((n) => n.id === id);
      if (node?.data?.tabId) affectedTabs.add(node.data.tabId as string);
      withHistoryOp(
        {
          opKey: 'opRemoveWidget',
          detailKey: widget ? widgetKindLabelKey(widget.kind) ?? undefined : undefined,
          target: widget ? widgetTarget(widget.kind) : { kind: 'nodes' },
        },
        () => {
          set((s) => {
            const newState: Partial<AppStore> = {
              inputPreviewValues: Object.fromEntries(
                Object.entries(s.inputPreviewValues).filter(([key]) => key !== id)
              ),
              rfNodes: s.rfNodes.filter((n) => n.id !== id),
              rfEdges: s.rfEdges.filter((e) => e.source !== id && e.target !== id),
            };
            if (
              widget &&
              (widget.kind === 'Waveform' ||
                widget.kind === 'PieChart' ||
                widget.kind === 'Image' ||
                widget.kind === 'RawData')
            ) {
              const remaining = s.dataTabs.filter((t) => t.id !== id);
              newState.dataTabs = remaining;
              if (s.activeDataTabId === id) {
                newState.activeDataTabId = remaining[0]?.id ?? 'compile-results-fixed';
              }
            }
            return newState;
          });
          affectedTabs.forEach((tabId) => { void get().syncTabGraph(tabId); });
        }
      );
    },

    updateWidget: (id, widget) =>
      withHistoryOp(
        {
          opKey: 'opUpdateWidgetParams',
          detailKey: widgetKindLabelKey(widget.kind) ?? undefined,
          target: widgetTarget(widget.kind),
        },
        () => {
          // 参数草稿按用户输入原样保留; 归一化由后端图提交统一执行
          const node = get().rfNodes.find((n) => n.id === id);
          const tabId = node?.data?.tabId as string | undefined;
          set((s) => ({
            rfNodes: s.rfNodes.map((n) =>
              n.id === id ? { ...n, data: { ...n.data, widget } } : n
            ),
            dataTabs: s.dataTabs.map((tab) =>
              tab.widgetId === id && 'label' in widget.params
                ? { ...tab, name: widget.params.label }
                : tab
            ),
          }));
          const inputValue = widgetInputValue(widget);
          if (inputValue !== null) get().setInputValue(id, inputValue);
          if (tabId) void get().syncTabGraph(tabId);
        },
        // 滑块拖拽等高频连续更新 — 同控件短窗内合并为一条
        { coalesceKey: `widget.params.${id}` }
      ),

    previewInputValue: (id, value) => {
      if (!Number.isFinite(value)) return;
      set((s) => ({ inputPreviewValues: { ...s.inputPreviewValues, [id]: value } }));
      get().setInputValue(id, value);
    },

    commitInputValue: (id, value) => {
      if (!Number.isFinite(value)) return;
      const widget = selectWidgets(get()).find((item) => item.params.id === id);
      set((s) => ({
        inputPreviewValues: Object.fromEntries(
          Object.entries(s.inputPreviewValues).filter(([key]) => key !== id)
        ),
      }));
      if (widget?.kind !== 'Knob' && widget?.kind !== 'Slider') return;
      if (widget.params.value !== value) {
        get().updateWidget(id, {
          kind: widget.kind,
          params: { ...widget.params, value },
        });
      }
      get().setInputValue(id, value);
    },
  };
}
