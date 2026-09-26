import { t } from '../../i18n';
import { loadAdapterCapabilities } from '../../lib/acquisition/capabilityCatalog';
import { createNodeFromCatalog } from '../../lib/models/createFromCatalog';
import { notify, formatError } from '../../lib/tauri/notifications';
import { api } from '../../lib/tauri/tauri';
import { nanoid } from 'nanoid';
import { withHistoryOp, type HistoryTarget } from '../historyStore';
import type { AppSlice } from './types';

/// 页签级操作的目标语义 (中性徽章)
const tabTarget = (): HistoryTarget => ({ kind: 'tab' });

export interface ControlTabSlice {
  controlTabs: { id: string; name: string }[];
  activeControlTabId: string;
  addControlTab: (name?: string) => void;
  addDefaultCanvas: () => Promise<void>;
  removeControlTab: (tabId: string) => void;
  setActiveControlTab: (tabId: string) => void;
  renameControlTab: (tabId: string, name: string) => void;
}

export const createControlTabSlice: AppSlice<ControlTabSlice> = (set, get) => {
  return {
    controlTabs: [{ id: 'default', name: 'Tab 1' }],
    activeControlTabId: 'default',

    addControlTab: (name) =>
      withHistoryOp({ opKey: 'opAddControlTab', target: tabTarget() }, () => {
        const id = nanoid(8);
        set((s) => {
          const tabName = name ?? `Tab ${s.controlTabs.length + 1}`;
          return {
            controlTabs: [...s.controlTabs, { id, name: tabName }],
            activeControlTabId: id,
          };
        });
        void get().syncTabGraph(id);
      }),

    addDefaultCanvas: async () => {
      try {
        const adapters = await loadAdapterCapabilities();
        if (!adapters.some(adapter => adapter.adapterId === 'serial' && adapter.endpoints.length > 0)) {
          notify.error(t(get().lang, 'defaultCanvasUnavailable'), t(get().lang, 'defaultCanvasUnavailable'), { source: 'addDefaultCanvas' });
          return;
        }
        get().addControlTab(t(get().lang, 'defaultCanvas'));
        const tabId = get().activeControlTabId;
        const raw = await createNodeFromCatalog({
          modelId: 'widget:RawData',
          position: { x: 560, y: 120 },
          tabId,
        });
        await get().seedInitialGraph(raw.id, 'user');
      } catch (error) {
        notify.error(t(get().lang, 'defaultCanvasUnavailable'), formatError(error));
      }
    },

    removeControlTab: (tabId) =>
      withHistoryOp(
        {
          opKey: 'opRemoveControlTab',
          detailText: get().controlTabs.find((t) => t.id === tabId)?.name,
          target: tabTarget(),
        },
        () => {
          if (!get().controlTabs.some(tab => tab.id === tabId)) return;
          for (const node of get().rfNodes.filter(n => n.data.tabId === tabId && n.type === 'acquisition')) {
            void api.closeTransport(node.id).catch(() => undefined);
          }
          set((s) => {
            const remaining = s.controlTabs.filter((t) => t.id !== tabId);
            if (!remaining.length) remaining.push({ id: nanoid(8), name: 'Tab 1' });
            const tabNodeIds = new Set(
              s.rfNodes.filter((n) => n.data.tabId === tabId).map((n) => n.id)
            );
            return {
              controlTabs: remaining,
              activeControlTabId:
                s.activeControlTabId === tabId ? remaining[0].id : s.activeControlTabId,
              rfNodes: s.rfNodes.filter((n) => n.data.tabId !== tabId),
              dataTabs: s.dataTabs.filter(t => !t.widgetId || !tabNodeIds.has(t.widgetId)),
              rfEdges: s.rfEdges.filter((e) => !tabNodeIds.has(e.source) && !tabNodeIds.has(e.target)),
            };
          });
          get().removeTabGraph(tabId);
          get().syncAllTabGraphs();
        }
      ),

    setActiveControlTab: (tabId) => set({ activeControlTabId: tabId }),

    renameControlTab: (tabId, name) =>
      withHistoryOp(
        { opKey: 'opRenameControlTab', detailText: name, target: tabTarget() },
        () =>
        set((s) => ({
          controlTabs: s.controlTabs.map((t) =>
            t.id === tabId ? { ...t, name } : t
          ),
        }))
      ),
  };
}
