// ============ 数据面板注册表 — 类型契约 ============
//
// 数据面板 (DataTab) 的「面板身份 → 元数据 + 视图」单一来源, 分为两个面:
//
//   - 元数据面 `PanelDef`  (panelDefs.ts)  — 无 React 组件, 可被 store / 图标层引用
//   - 视图面   `PANEL_VIEWS` (panelViews.tsx) — 同一 PanelKind 键空间, 同样编译期穷举
//
// 拆分理由是模块图, 不是语义: 视图面传递引用整个显示层 (WaveformChart /
// TableView / Model3D …), 而 widgetTab → dataTabs → appStore 链路必须保持
// 无显示层依赖 (既有代码刻意规避该循环, 见 dataTabs.ts 的 widgetTabTypeOfKind
// 注释)。两个面都以 `Record<PanelKind, …>` 穷举, 新增面板时任一面遗漏都编译失败。
//
// 权威划分 (与后端 `PanelDescriptor` 一致):
//   后端权威 = 面板枚举 / tabType / category / labelKey / dataPlane / binding / 端口
//   前端权威 = icon / TabView (React 值不可序列化)
// 注册表是后端契约的**声明式镜像**: 前端的期望在编译期固化, 运行时由
// reconcile.ts 与后端下发的目录比对, 分歧显式暴露而不是静默漂移。

import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { DataTab, DataTabType, WidgetConfig } from '../../../types';
import type { WidgetKind } from '../../widgets/registryTypes';
import type { PanelBinding } from '../../../types/generated/PanelBinding';
import type { PanelDataPlane } from '../../../types/generated/PanelDataPlane';
import type { PanelKind } from '../../../types/generated/PanelKind';

/// 纯应用外壳的 tab 类型 — 不是数据面板, 没有后端契约。
///
/// 与后端 `graph::kind::widgets::panel_spec::SHELL_TAB_TYPES` 同集合,
/// 这里收紧成 union 以便 `SHELL_TAB_ICONS` / `SHELL_TAB_CONTENT` 编译期穷举。
export type ShellTabType =
  | 'compile-errors'
  | 'compile-results'
  | 'operation-history'
  | 'node-properties'
  | 'recording-database'
  | 'performance-monitor';

/// 一个数据面板的前端声明 (后端 `PanelDescriptor` 的镜像)。
export interface PanelDef {
  /// 后端面板身份 — 与 generated `PanelKind` 同一 union, 注册表键即穷举检查。
  readonly panelKind: PanelKind;
  /// 打开该面板产生的 DataTab 类型 (镜像后端 `PanelDescriptor.tabType`)。
  readonly tabType: DataTabType;
  /// 画布宿主控件 kind; `null` = 无宿主控件的整库面板 (can / logic)。
  readonly hostWidgetKind: WidgetKind | null;
  /// tab 条与面板列表共用的图标。
  readonly icon: LucideIcon;
  /// tab 标题 i18n 键 (en / zh 同名, 由前端解析)。
  readonly labelKey: string;
  /// 数据面投递契约 (镜像后端 `PanelDescriptor.dataPlane`)。
  readonly dataPlane: PanelDataPlane;
  /// 图节点绑定语义 (镜像后端 `PanelDescriptor.binding`)。
  ///
  /// `edgeBound` 的具体句柄由后端从宿主控件端口表投影
  /// (`app::models::catalog::resolve_binding`), 前端声明为空数组 —— 前端不复制
  /// 第三套端口表; reconcile 对 `edgeBound` 只比对绑定种类。
  readonly binding: PanelBinding;
}

/// 面板视图的统一 props —— 视图只声明自己需要的部分。
export interface PanelTabViewProps {
  /// 正在渲染的数据面板 tab。
  readonly tab: DataTab;
  /// 该 tab 解析出的宿主控件实例; 整库面板 (can / logic) 与宿主已删除时缺省。
  /// 视图必须自行按 kind 收窄, 不得盲信。
  readonly widget: WidgetConfig | undefined;
  /// 画布上的全部控件实例 —— 跨面板查询用 (TableView 读 Command 的 loopback 历史)。
  readonly widgets: readonly WidgetConfig[];
}

/// 面板视图组件类型 —— `PANEL_VIEWS` 的取值类型。
export type PanelTabView = ComponentType<PanelTabViewProps>;
