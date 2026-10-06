// ============ Widget 注册表类型契约 ============
//
// 所有 widget 组件与属性编辑器的统一 props 契约, 以及单控件声明式定义
// WidgetDef — registry.ts 聚合全部 WidgetDef, 成为唯一的 kind→实现 分发点。
//
// 组件契约: widget 组件是「纯内容」— 不含卡片 chrome (节点框/端口/删除按钮由
// WidgetNode 提供, 数据窗口外壳由 WidgetSurface 提供), 统一 memo。

import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { WidgetConfig, WidgetKind } from '../../types';

// 种类的唯一权威在实现层 (src/types/widgets.ts); 这里只做转发, 免得出现第二处定义。
export type { WidgetKind };

export interface WidgetComponentProps<K extends WidgetKind = WidgetKind> {
  widget: Extract<WidgetConfig, { kind: K }>;
}

/// 属性面板编辑器 — update 收同 kind 的新配置 (写穿 store.updateWidget)
export interface WidgetPropertiesProps<K extends WidgetKind = WidgetKind> {
  widget: Extract<WidgetConfig, { kind: K }>;
  update: (next: Extract<WidgetConfig, { kind: K }>) => void;
}

/// 单个控件 kind 的声明式定义
///
/// 这里**没有**端口表: 端口的唯一权威是后端 `describe_node_documents`
/// (见 `nodes/WidgetNode.tsx`), 前端再声明一份就会造出第二处真相。
export interface WidgetDef<K extends WidgetKind = WidgetKind> {
  kind: K;
  /// 节点内 / 数据窗口共用的内容组件
  Component: ComponentType<WidgetComponentProps<K>>;
  /// 属性面板专用编辑节; 缺省 = 仅通用字段 (名称/尺寸)
  Properties?: ComponentType<WidgetPropertiesProps<K>>;
  /// palette / 历史面板图标
  icon: LucideIcon;
  /// i18n key (widget.<labelKey>) — palette 与窗口标题共用
  labelKey: string;
}
