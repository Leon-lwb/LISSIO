import { t } from '../../i18n';
import type { DataTab, WidgetConfig } from '../../types';
import { NODE_PROPERTIES_TAB_ID } from '../../types';
import { useAppStore } from '../appStore';
import { widgetToTab, widgetTabType } from '../../lib/utils/widgetTab';
import { selectWidgets } from '../appStoreHelpers';
import { HOST_PANEL_DEFS, panelDefForTabType } from '../../components/panels/registry/panelDefs';
import type { PanelKind } from '../../types/generated/PanelKind';
import type { AppSlice } from './types';

export interface DataTabSlice {
  dataTabs: DataTab[];
  activeDataTabId: string;
  addDataTab: (tab: DataTab) => void;
  removeDataTab: (tabId: string) => void;
  setActiveDataTab: (tabId: string) => void;
  addCanTab: () => void;
  addLogicTab: () => void;
  /// 整库唯一 — 首次创建后再次调用会切到已存在 tab,
  /// 新建 tab 由 DockLayout useEffect → reconcile 自动安置到 focusedCard.tabIds
  addCompileErrorsTab: () => void;
  /// 新增 — 编译结果面板 (连接列表)
  addCompileResultsTab: () => void;
  /// 新增 — 操作历史面板 (撤销/重做记录, 恒定单例)
  addOperationHistoryTab: () => void;
  /// 新增 — 节点属性面板 (选中画布节点后自动激活, 恒定单例)
  addNodePropertiesTab: () => void;
  /// 新增 — 录制数据库面板 (恒定单例, 由侧边栏入口打开)
  addRecordingDatabaseTab: () => void;
  /// 新增 — 由控件 id 构造对应窗口 Tab (已存在则激活, 否则新建并激活)
  addWidgetTab: (widget: WidgetConfig) => void;
}

export const createDataTabSlice: AppSlice<DataTabSlice> = (set, get) => {
  return {
    dataTabs: [
      { id: 'compile-errors-fixed', type: 'compile-errors', name: 'Compile Errors', closable: false },
      { id: 'compile-results-fixed', type: 'compile-results', name: 'Compile Results', closable: false },
      // 节点属性面板 — 默认布局 (dockStore defaultRoot) 的专属卡片承载此 tab;
      // id 稳定, 用户关闭后再次选中节点由 addNodePropertiesTab 按同 id 重建
      { id: NODE_PROPERTIES_TAB_ID, type: 'node-properties', name: 'Properties', closable: true },
    ],
    activeDataTabId: 'compile-results-fixed',

    addDataTab: (tab) =>
      set((s) => ({
        dataTabs: [...s.dataTabs, tab],
        activeDataTabId: tab.id,
      })),

    removeDataTab: (tabId) =>
      set((s) => {
        const tab = s.dataTabs.find((t: DataTab) => t.id === tabId);
        if (!tab?.closable) return s;
        const remaining = s.dataTabs.filter((t: DataTab) => t.id !== tabId);
        return {
          dataTabs: remaining,
          activeDataTabId:
            s.activeDataTabId === tabId ? remaining[0]?.id ?? 'waveform-fixed' : s.activeDataTabId,
        };
      }),

    setActiveDataTab: (tabId) => set({ activeDataTabId: tabId }),

    addCanTab: () => {
      const existing = get().dataTabs.find((t: DataTab) => t.type === 'can');
      if (existing) {
        set({ activeDataTabId: existing.id });
        return;
      }
      const tab: DataTab = {
        id: `can-${Date.now()}`,
        type: 'can',
        name: t(get().lang, 'canFrames'),
        closable: true,
      };
      set({
        dataTabs: [...get().dataTabs, tab],
        activeDataTabId: tab.id,
      });
    },

    addLogicTab: () => {
      const existing = get().dataTabs.find((t: DataTab) => t.type === 'logic');
      if (existing) {
        set({ activeDataTabId: existing.id });
        return;
      }
      const tab: DataTab = {
        id: `logic-${Date.now()}`,
        type: 'logic',
        name: t(get().lang, 'logicAnalyzer'),
        closable: true,
      };
      set({
        dataTabs: [...get().dataTabs, tab],
        activeDataTabId: tab.id,
      });
    },

    addCompileErrorsTab: () => {
      const existing = get().dataTabs.find((t: DataTab) => t.type === 'compile-errors');
      if (existing) {
        set({ activeDataTabId: existing.id });
        return;
      }
      const tab: DataTab = {
        id: `compile-errors-${Date.now()}`,
        type: 'compile-errors',
        name: t(get().lang, 'compileErrorsTitle'),
        closable: true,
      };
      set({
        dataTabs: [...get().dataTabs, tab],
        activeDataTabId: tab.id,
      });
      // dockStore 的安置由 DockLayout useEffect → reconcile 自动处理
      // (reconcile 把 missing tabId 推入 focusedCard.tabIds 或首个 data card)
    },

    addCompileResultsTab: () => {
      // 整库已固定存在 compile-results-fixed; 此 action 面向后续版本可能开放的
      // 多个独立结果实例, 也允许在 fixed Tab 不可用时兜底新建
      const existingFixed = get().dataTabs.find((t: DataTab) => t.id === 'compile-results-fixed');
      if (existingFixed) {
        set({ activeDataTabId: existingFixed.id });
        return;
      }
      const tab: DataTab = {
        id: 'compile-results-fixed',
        type: 'compile-results',
        name: t(get().lang, 'connectionResultsTitle'),
        closable: false,
      };
      set({
        dataTabs: [...get().dataTabs, tab],
        activeDataTabId: tab.id,
      });
    },

    addOperationHistoryTab: () => {
      const existing = get().dataTabs.find((t: DataTab) => t.type === 'operation-history');
      if (existing) {
        set({ activeDataTabId: existing.id });
        return;
      }
      const tab: DataTab = {
        id: `operation-history-${Date.now()}`,
        type: 'operation-history',
        name: t(get().lang, 'operationHistoryTitle'),
        closable: true,
      };
      set({
        dataTabs: [...get().dataTabs, tab],
        activeDataTabId: tab.id,
      });
    },

    addRecordingDatabaseTab: () => {
      const existing = get().dataTabs.find((t: DataTab) => t.type === 'recording-database');
      if (existing) {
        set({ activeDataTabId: existing.id });
        return;
      }
      const tab: DataTab = {
        id: 'recording-database',
        type: 'recording-database',
        name: t(get().lang, 'recordingDatabaseTitle'),
        closable: true,
      };
      set({
        dataTabs: [...get().dataTabs, tab],
        activeDataTabId: tab.id,
      });
    },

    addNodePropertiesTab: () => {
      const existing = get().dataTabs.find((t: DataTab) => t.type === 'node-properties');
      if (existing) {
        set({ activeDataTabId: existing.id });
        return;
      }
      // id 固定 — 默认布局的专属卡片 (dockStore / quickstart buildDock) 按 id 预置此 tab,
      // 关闭后重建仍落回同一张卡 (选中节点等入口还会经 dockPropertiesTab 右侧停靠)
      const tab: DataTab = {
        id: NODE_PROPERTIES_TAB_ID,
        type: 'node-properties',
        name: t(get().lang, 'nodeProperties'),
        closable: true,
      };
      set({
        dataTabs: [...get().dataTabs, tab],
        activeDataTabId: tab.id,
      });
    },

    addWidgetTab: (widget) => {
      const tab = widgetToTab(widget);
      if (!tab) return;
      const existing = get().dataTabs.find((t: DataTab) => t.id === tab.id);
      if (existing) {
        set({ activeDataTabId: existing.id });
        return;
      }
      set({
        dataTabs: [...get().dataTabs, tab],
        activeDataTabId: tab.id,
      });
    },
  };
}

// ============================================================
// 数据面板菜单条目的「单一事实源」
// ============================================================
//
// 菜单栏 (Windows MenuBar / 原生 menu_shell) 与侧边栏 (QuickStart / CategoryPanel)
// 三个入口共用同一份条目定义, 派生面板的 available 计算 (画布是否有该类 widget)
// 也只此一处。条目结构:
//   { type, labelKey, available, open }
//
// 独立面板 = 应用外壳 (无后端契约) + 整库数据面板 (注册表里的无宿主面板);
// 派生面板由注册表的有宿主面板逐个投影, 按 widgets.some(...) 决定是否可点。

import type { AppStore } from '../appStore';

export interface DataPanelEntry {
  /// DataTabType 字符串 — 仅作图标 / 类型查询
  type: DataTab['type'];
  /// i18n key (en.yml / zh.yml 同名)
  labelKey: string;
  /// 始终可用 (独立面板) / 按 widget 存在动态可用 (派生面板)
  available: boolean;
  /// 触发打开的副作用 — 调用 store action + 切到目标 Tab 所在 Dock 卡片
  open: () => void;
  /// 分组 — 'standalone' = 独立面板, 'derived' = 由 widget 派生
  group: 'standalone' | 'derived';
}

/// 面板条目需要的 store action 子集 (菜单 / 侧边栏传入 store 本身即可)。
type DataPanelActions = Pick<
  AppStore,
  | 'addCompileErrorsTab'
  | 'addCompileResultsTab'
  | 'addCanTab'
  | 'addLogicTab'
  | 'addOperationHistoryTab'
  | 'addNodePropertiesTab'
  | 'addDataTab'
  | 'setActiveDataTab'
  | 'addWidgetTab'
>;

/// 独立面板的展示顺序 = 应用外壳与整库数据面板交错后的既定顺序。
/// 外壳没有后端契约, 无法从注册表推导, 因此顺序在此显式排列;
/// 出现在此表中的整库数据面板身份仍由注册表决定 (见 standaloneEntryOf)。
const STANDALONE_ORDER: readonly DataTab['type'][] = [
  'compile-errors',
  'compile-results',
  'can',
  'logic',
  'operation-history',
  'node-properties',
];

/// 应用外壳的菜单标签与创建动作 —— 外壳没有后端契约, 只此一处声明。
const SHELL_PANEL_ENTRIES: Partial<Record<DataTab['type'], {
  labelKey: string;
  open: (actions: DataPanelActions) => void;
}>> = {
  'compile-errors': {
    labelKey: 'menuPanelOpenCompileErrors',
    open: (actions) => actions.addCompileErrorsTab(),
  },
  'compile-results': {
    labelKey: 'menuPanelOpenCompileResults',
    open: (actions) => actions.addCompileResultsTab(),
  },
  'operation-history': {
    labelKey: 'menuPanelOpenOperationHistory',
    open: (actions) => actions.addOperationHistoryTab(),
  },
  'node-properties': {
    labelKey: 'menuPanelOpenNodeProperties',
    open: (actions) => actions.addNodePropertiesTab(),
  },
};

/// 整库数据面板 → 所在 slice 的创建动作。
/// 注册表决定「谁是无宿主数据面板」, 这里只补「怎么开」—— store action 无法
/// 进入注册表 (它在 appStore 上)。新增整库面板时此表必须同步, 由
/// `dataTabs` 的单元测试守卫 (注册表里的每个无宿主面板都必须有 opener)。
const SINGLETON_PANEL_OPENERS: Partial<Record<PanelKind, (actions: DataPanelActions) => void>> = {
  can: (actions) => actions.addCanTab(),
  logic: (actions) => actions.addLogicTab(),
};

/// 独立面板 (外壳 + 整库数据面板) 的条目来源 — 外壳与注册表两条分支只此一处判断。
function standaloneEntryOf(
  type: DataTab['type'],
  actions: DataPanelActions
): { labelKey: string; open: () => void } | null {
  const shell = SHELL_PANEL_ENTRIES[type];
  if (shell) return { labelKey: shell.labelKey, open: () => shell.open(actions) };
  const def = panelDefForTabType(type);
  if (def === undefined) return null;
  if (def.hostWidgetKind !== null) return null;
  const openSingleton = SINGLETON_PANEL_OPENERS[def.panelKind];
  return openSingleton ? { labelKey: def.labelKey, open: () => openSingleton(actions) } : null;
}

export function getAvailableDataPanelEntries(
  state: Pick<AppStore, 'dataTabs' | 'rfNodes' | 'lang'>,
  actions: DataPanelActions,
): DataPanelEntry[] {
  const widgets = selectWidgets(state);
  // 同一 kind 可有多个 widget (例如多个 Waveform) — 取首个派生 Tab 用作打开目标
  const firstWidgetOf = (kind: WidgetConfig['kind']) =>
    widgets.find((w) => w.kind === kind) ?? null;

  const standalone: DataPanelEntry[] = [];
  for (const type of STANDALONE_ORDER) {
    const entry = standaloneEntryOf(type, actions);
    if (!entry) continue;
    standalone.push({
      type,
      labelKey: entry.labelKey,
      available: true,
      open: entry.open,
      group: 'standalone',
    });
  }

  const derived: DataPanelEntry[] = [];
  for (const def of HOST_PANEL_DEFS) {
    const kind = def.hostWidgetKind;
    if (kind === null) continue;
    const widget = firstWidgetOf(kind);
    derived.push({
      type: def.tabType,
      labelKey: def.labelKey,
      available: widget != null,
      open: () => {
        if (!widget) return;
        actions.addWidgetTab(widget);
      },
      group: 'derived',
    });
  }

  return [...standalone, ...derived];
}

// ============================================================
// 数据面板 Tab 轮转
// ============================================================
//
// 在同一 DataTabType 的多个 Tab 间循环跳 (Waveform / Spectrum / RawData / ...
// 同类控件可有多个, 因此派生面板常有 > 1 个 Tab)。
// - 已有 ≥ 2 个匹配 Tab: 当前 active 是其一 → 下一个; 否则第一个
// - 仅 1 个匹配: 激活它
// - 0 个匹配: 创建并激活
//   - 独立类型走 standaloneEntryOf 的动作 (注意 can / logic 无固定初始 Tab,
//     首次打开必须靠这里兜底创建; compile-errors / results 才有 fixed 初始 Tab)
//   - 派生类型找到画布首个同类 widget, addWidgetTab 创建并激活

export function cycleDataPanelTab(type: DataTab['type']): void {
  const app = useAppStore.getState();
  const matching = app.dataTabs.filter((tab) => tab.type === type);
  if (matching.length === 0) {
    // 独立类型: 对应创建动作 (已存在则切过去, 不存在则创建)
    const standalone = standaloneEntryOf(type, app);
    if (standalone) {
      standalone.open();
      return;
    }
    // 派生类型: 用首个同类 widget 创建
    const widget = selectWidgets(app).find((w) => widgetTabType(w.kind) === type);
    if (widget) app.addWidgetTab(widget);
    return;
  }
  // 多个匹配: 取当前 active 的索引, +1, 越界回到 0
  const currentIdx = matching.findIndex((t) => t.id === app.activeDataTabId);
  const next = matching[(currentIdx + 1) % matching.length];
  app.setActiveDataTab(next.id);
}
