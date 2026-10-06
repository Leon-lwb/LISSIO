//! 控件 → 数据窗口 Tab 的映射
//!
//! 部分控件 (波形/原始数据/CAN 解码等) 在画布上是节点占位, 实际内容渲染在
//! 数据区 Dock 窗口 (DataTab) 中。
//!
//! 「哪类控件可独立开窗、开成哪个 tab」由数据面板注册表
//! (`components/panels/registry`) 唯一提供, 本模块只负责「控件实例 → 窗口 tab」
//! 的构造, 供 addWidget (拖入自动开窗) 与 WidgetNode 双击重开窗口共用。

import type { DataTab, DataTabType, WidgetConfig } from '../../types';
import { panelDefForWidget } from '../panels/panelDefs';

/// 控件是否拥有可独立开合的窗口, 以及对应的 Tab 类型
/// 与 addWidget 的建 Tab 逻辑保持一致: 仅这些控件会创建数据窗口
export function widgetTabType(kind: WidgetConfig['kind']): DataTabType | null {
  return panelDefForWidget(kind)?.tabType ?? null;
}

/// 窗口 Tab 显示名 — 面板宿主控件的参数都自带 label; 缺省回落控件 kind
function windowTabName(widget: WidgetConfig): string {
  return 'label' in widget.params ? widget.params.label : widget.kind;
}

/// 由控件构造数据窗口 Tab; 无窗口的控件返回 null
/// Tab id 与控件 id 相同, 保证「关闭窗口后双击节点可重新打开」
export function widgetToTab(widget: WidgetConfig): DataTab | null {
  const type = widgetTabType(widget.kind);
  if (!type) return null;
  return {
    id: widget.params.id,
    type,
    name: windowTabName(widget),
    widgetId: widget.params.id,
    closable: true,
  };
}
