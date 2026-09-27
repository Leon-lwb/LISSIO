// ============ 数据面板注册表 — 元数据面 ============
//
// 12 个数据驱动面板的「面板身份 → tab 类型 / 宿主控件 / 图标 / i18n 键 / 数据面 /
// 绑定」声明。这里是前端侧的唯一权威: `widgetTab.ts` (控件 → 窗口映射)、
// `dataTabs.ts` (菜单条目 / 轮转)、`DataTabIcon` / `DataPanelsPanel` (图标) 全部
// 从这里派生, 不再各自维护平行表。
//
// 值镜像后端 `kind::widgets::PanelSpec` 与 `app::models::catalog::panel_descriptors`
// 的下发结果, 因此后端新增/改名面板时, 这里必须同步 —— 运行时由 `reconcile.ts`
// 比对后端目录, 分歧显式暴露。
//
// 声明顺序 = 菜单 / 面板列表顺序 (Object.values 保持字符串键插入序, 由
// `__tests__/panelRegistry.test.ts` 钉死)。独立面板 (can / logic, 无宿主控件)
// 排在派生面板之后, 因为菜单把它们并入 standalone 分组。

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Box,
  CircuitBoard,
  Cpu,
  Database,
  History,
  Image as ImageIcon,
  LineChart,
  ListTree,
  PieChart as PieIcon,
  ScanText,
  Send,
  Settings2,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import type { DataTabType } from '../../../types';
import type { WidgetKind } from '../../widgets/registryTypes';
import type { PanelKind } from '../../../types/generated/PanelKind';
import type { PanelDef, ShellTabType } from './panelTypes';

/// 12 个数据驱动面板 —— 键即 `PanelKind`, 遗漏或多余都会编译失败。
export const PANEL_DEFS: Readonly<Record<PanelKind, PanelDef>> = {
  waveform: {
    panelKind: 'waveform',
    tabType: 'waveform-extra',
    hostWidgetKind: 'Waveform',
    icon: LineChart,
    labelKey: 'dataTabWaveform',
    dataPlane: {
      delivery: 'both',
      pushRequest: 'waveform',
      fetchOp: 'waveformWindow',
      defaultIntervalMs: 33,
      defaultMaxItems: 4096,
    },
    binding: { kind: 'edgeBound', inputHandles: [] },
  },
  spectrum: {
    panelKind: 'spectrum',
    tabType: 'spectrum',
    hostWidgetKind: 'Spectrum',
    icon: BarChart3,
    labelKey: 'dataTabSpectrum',
    dataPlane: {
      delivery: 'both',
      pushRequest: 'spectrum',
      fetchOp: 'spectrum',
      defaultIntervalMs: 33,
    },
    binding: { kind: 'edgeBound', inputHandles: [] },
  },
  raw: {
    panelKind: 'raw',
    tabType: 'raw',
    hostWidgetKind: 'RawData',
    icon: Activity,
    labelKey: 'dataTabRawData',
    dataPlane: {
      delivery: 'both',
      pushRequest: 'raw_data',
      fetchOp: 'rawData',
      defaultIntervalMs: 100,
      defaultMaxItems: 65536,
    },
    // 原始数据面板的输入口由参数 `selectedInput` 持有 (静态回退口 "data",
    // 动态口形如 `src:<sourceId>:<sourceHandle>`) — 与 describe 层同源。
    binding: { kind: 'configBound', configKey: 'selectedInput', portTemplate: 'src:{source}:{handle}' },
  },
  pie: {
    panelKind: 'pie',
    tabType: 'pie',
    hostWidgetKind: 'PieChart',
    icon: PieIcon,
    labelKey: 'dataTabPie',
    dataPlane: {
      delivery: 'both',
      pushRequest: 'port_samples',
      fetchOp: 'graphOutputs',
      defaultIntervalMs: 33,
    },
    binding: { kind: 'edgeBound', inputHandles: [] },
  },
  image: {
    panelKind: 'image',
    tabType: 'image',
    hostWidgetKind: 'Image',
    icon: ImageIcon,
    labelKey: 'dataTabImage',
    // 图像帧尚无推送流, 后端也没有可服务的拉取操作 —— 显式声明「无数据面」
    // 而不是编造一个拉取名 (后端 `panel_spec::validate` 拒绝预支能力名)。
    dataPlane: { delivery: 'unavailable' },
    binding: { kind: 'edgeBound', inputHandles: [] },
  },
  model3d: {
    panelKind: 'model3d',
    tabType: 'model3d',
    hostWidgetKind: 'Model3D',
    icon: Box,
    labelKey: 'dataTabModel3d',
    dataPlane: {
      delivery: 'both',
      pushRequest: 'port_samples',
      fetchOp: 'graphOutputs',
      defaultIntervalMs: 17,
    },
    binding: { kind: 'edgeBound', inputHandles: [] },
  },
  'table-view': {
    panelKind: 'table-view',
    tabType: 'table-view',
    hostWidgetKind: 'TableView',
    icon: BarChart3,
    labelKey: 'tableViewLabel',
    dataPlane: {
      delivery: 'both',
      pushRequest: 'port_samples',
      fetchOp: 'graphOutputs',
      defaultIntervalMs: 100,
      defaultMaxItems: 100,
    },
    binding: { kind: 'edgeBound', inputHandles: [] },
  },
  command: {
    panelKind: 'command',
    tabType: 'command',
    hostWidgetKind: 'Command',
    icon: Send,
    labelKey: 'dataTabCommand',
    dataPlane: {
      delivery: 'both',
      pushRequest: 'port_samples',
      fetchOp: 'graphOutputs',
      defaultIntervalMs: 33,
    },
    binding: { kind: 'edgeBound', inputHandles: [] },
  },
  'frame-decoder': {
    panelKind: 'frame-decoder',
    tabType: 'frame-decoder',
    hostWidgetKind: 'FrameDecoder',
    icon: ScanText,
    labelKey: 'dataTabFrameDecoder',
    dataPlane: {
      delivery: 'both',
      pushRequest: 'decoded_events',
      fetchOp: 'decodedEvents',
      defaultIntervalMs: 33,
      defaultMaxItems: 200,
    },
    binding: { kind: 'edgeBound', inputHandles: [] },
  },
  trigger: {
    panelKind: 'trigger',
    tabType: 'trigger',
    hostWidgetKind: 'Trigger',
    icon: Zap,
    labelKey: 'dataTabTrigger',
    dataPlane: {
      delivery: 'both',
      pushRequest: 'port_samples',
      fetchOp: 'graphOutputs',
      defaultIntervalMs: 33,
    },
    binding: { kind: 'edgeBound', inputHandles: [] },
  },
  can: {
    panelKind: 'can',
    tabType: 'can',
    hostWidgetKind: null,
    icon: Cpu,
    labelKey: 'menuPanelOpenCan',
    dataPlane: {
      delivery: 'both',
      pushRequest: 'can_frames',
      fetchOp: 'canFrames',
      defaultIntervalMs: 100,
      defaultMaxItems: 200,
    },
    binding: { kind: 'singleton' },
  },
  logic: {
    panelKind: 'logic',
    tabType: 'logic',
    hostWidgetKind: null,
    icon: CircuitBoard,
    labelKey: 'menuPanelOpenLogic',
    dataPlane: {
      delivery: 'both',
      pushRequest: 'logic_samples',
      fetchOp: 'logicSamples',
      defaultIntervalMs: 33,
      defaultMaxItems: 500,
    },
    binding: { kind: 'singleton' },
  },
};

/// 5 个纯应用外壳 tab 的图标 — 它们是 UI 外壳而非数据面板, 因此没有后端契约,
/// 只有图标归此表。内容元素在 `panelViews.tsx` (视图面)。
export const SHELL_TAB_ICONS: Readonly<Record<ShellTabType, LucideIcon>> = {
  'compile-errors': AlertTriangle,
  'compile-results': ListTree,
  'operation-history': History,
  'node-properties': Settings2,
  'recording-database': Database,
};

/// 历史 tab 类型别名 —— `waveform` 是 `waveform-extra` 的旧拼写, 归一后再查表。
/// 归一发生在查询层, 使 `DataTabType` 的持久化形状不必收紧 (不在本期范围)。
const TAB_TYPE_ALIASES: Partial<Record<DataTabType, DataTabType>> = {
  waveform: 'waveform-extra',
};

/// 面板声明顺序 = 菜单 / 面板列表顺序。
export const PANEL_DEFS_ORDERED: readonly PanelDef[] = Object.values(PANEL_DEFS);

/// 派生面板 (有宿主控件) —— 菜单 'derived' 分组顺序。
export const HOST_PANEL_DEFS: readonly PanelDef[] = PANEL_DEFS_ORDERED.filter(
  (def) => def.hostWidgetKind !== null
);

/// 整库面板 (无宿主控件) —— 菜单 'standalone' 分组中的两个数据面板。
export const SINGLETON_PANEL_DEFS: readonly PanelDef[] = PANEL_DEFS_ORDERED.filter(
  (def) => def.hostWidgetKind === null
);

function buildIndex(): {
  readonly byTabType: ReadonlyMap<DataTabType, PanelDef>;
  readonly byHostWidget: ReadonlyMap<WidgetKind, PanelDef>;
} {
  const byTabType = new Map<DataTabType, PanelDef>();
  const byHostWidget = new Map<WidgetKind, PanelDef>();
  for (const def of PANEL_DEFS_ORDERED) {
    byTabType.set(def.tabType, def);
    if (def.hostWidgetKind !== null) byHostWidget.set(def.hostWidgetKind, def);
  }
  for (const alias of Object.keys(TAB_TYPE_ALIASES) as DataTabType[]) {
    const canonical = TAB_TYPE_ALIASES[alias];
    const def = canonical === undefined ? undefined : byTabType.get(canonical);
    if (def) byTabType.set(alias, def);
  }
  return { byTabType, byHostWidget };
}

const PANEL_INDEX = buildIndex();

/// tab 类型 → 面板定义 (含 `waveform` 历史别名归一); 非数据面板返回 undefined。
export function panelDefForTabType(type: DataTabType): PanelDef | undefined {
  return PANEL_INDEX.byTabType.get(type);
}

/// 面板身份 → 面板定义 (后端目录里的未知身份返回 undefined)。
export function panelDefForKind(kind: string): PanelDef | undefined {
  return (PANEL_DEFS as Record<string, PanelDef | undefined>)[kind];
}

/// 控件 kind → 面板定义; 非数据面板控件 (Knob / Math / …) 返回 undefined。
export function panelDefForWidget(kind: WidgetKind): PanelDef | undefined {
  return PANEL_INDEX.byHostWidget.get(kind);
}

/// 控件 kind → 可独立开合的窗口 tab 类型; 无窗口的控件返回 null。
export function panelKindOfWidget(kind: WidgetKind): PanelKind | null {
  return panelDefForWidget(kind)?.panelKind ?? null;
}

/// tab 类型是否为纯应用外壳。
export function isShellTabType(type: DataTabType): type is ShellTabType {
  return Object.prototype.hasOwnProperty.call(SHELL_TAB_ICONS, type);
}

/// tab 类型 → 图标 (数据面板走注册表, 外壳走外壳表); 未知类型返回 null。
export function panelIconForTabType(type: DataTabType): LucideIcon | null {
  const def = panelDefForTabType(type);
  if (def) return def.icon;
  return isShellTabType(type) ? SHELL_TAB_ICONS[type] : null;
}
